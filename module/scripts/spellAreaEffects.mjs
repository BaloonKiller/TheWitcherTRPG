import { fromUuidSync } from "../setup/foundry-compat.js";
import {
  buildPersistentSpellAreaEffect,
  createSpellAreaTargetState,
  getSpellAreaTarget,
  getSpellAreaExpirationState,
  isExcludedSpellAreaCaster,
  isSpellAreaResolutionComplete,
  updateSpellAreaMessage,
} from "./spellArea.mjs";

const FLAG_SCOPE = "thewitchertrpg";
const FLAG_KEY = "spellArea";
const EFFECT_FLAG_KEY = "spellAreaEffect";
let recalculateActor = null;

export function registerSpellAreaEffectHooks(hooks = globalThis.Hooks, updateDerived = null) {
  if (!hooks?.on) return;
  recalculateActor = updateDerived;

  hooks.on("createRegion", (region, _options, userId) => {
    if (!isOriginatingClient(userId)) return;
    void reconcileSpellAreaRegion(region, { notify: true });
  });
  hooks.on("updateRegion", (region, changes, _options, userId) => {
    if (!isOriginatingClient(userId) || !regionChangeAffectsArea(changes)) return;
    void reconcileSpellAreaRegion(region);
  });
  hooks.on("deleteRegion", (region, options, userId) => {
    if (!isOriginatingClient(userId)) return;
    void finishSpellAreaRegion(region, options?.witcherSpellAreaEndReason ?? "manual");
  });
  hooks.on("createToken", (token, _options, userId) => {
    if (!isOriginatingClient(userId)) return;
    void reconcileSpellAreaToken(token, { notify: true });
  });
  hooks.on("updateToken", (token, changes, _options, userId) => {
    if (!isOriginatingClient(userId) || !tokenChangeAffectsArea(changes)) return;
    void reconcileSpellAreaToken(token, { notify: true });
  });
  hooks.on("deleteToken", (token, _options, userId) => {
    if (!isOriginatingClient(userId)) return;
    void removeTokenSpellAreaEffects(token);
  });
  hooks.on("canvasReady", () => {
    if (!game.user?.isGM) return;
    void expireAndReconcileSceneSpellAreas(canvas.scene, game.combat);
  });
  hooks.on("updateCombat", (combat, changes, _options, userId) => {
    if (!game.user?.isGM || !isOriginatingClient(userId) || !("round" in (changes ?? {}))) return;
    void expireSpellAreaRegions(combat);
  });
  hooks.on("updateChatMessage", (message, changes) => {
    if (!chatMessageChangeAffectsSpellArea(changes)) return;
    void endResolvedSpellArea(message);
  });
}

async function expireAndReconcileSceneSpellAreas(scene, combat) {
  await expireSpellAreaRegions(combat, scene);
  await reconcileSceneSpellAreas(scene);
}

export async function expireSpellAreaRegions(combat, scene = null) {
  if (!combat) return [];
  const combatScene = scene
    ?? (combat.scene?.regions ? combat.scene : null)
    ?? game.scenes?.get?.(combat.sceneId ?? combat.scene?.id ?? combat.scene)
    ?? (canvas.scene?.id === (combat.sceneId ?? combat.scene?.id ?? combat.scene) ? canvas.scene : null);
  if (!combatScene) return [];

  const expired = [];
  for (const region of combatScene.regions ?? []) {
    const area = getAreaFlag(region);
    if (!getSpellAreaExpirationState(area, combat).expired) continue;
    expired.push(region);
    await region.delete({ witcherSpellAreaEndReason: "expired" });
  }
  return expired;
}

export async function endResolvedSpellArea(message) {
  const area = message?.getFlag?.(FLAG_SCOPE, FLAG_KEY);
  if (!isSpellAreaResolutionComplete(area)) return false;

  const region = area?.regionUuid ? fromUuidSync(area.regionUuid) : null;
  if (!region) {
    await updateSpellAreaMessage(message, {
      areaPatch: { ended: true, endReason: "resolved" },
    });
    return true;
  }
  if (getAreaFlag(region)?.persistentEffect || !isSpellAreaLifecycleClient(region)) {
    return false;
  }

  try {
    await region.delete({ witcherSpellAreaEndReason: "resolved" });
    return true;
  } catch (error) {
    console.warn("TheWitcherTRPG | Could not end the resolved spell area.", error);
    return false;
  }
}

export async function reconcileSceneSpellAreas(scene, options = {}) {
  if (!scene) return;
  for (const region of scene.regions ?? []) {
    await reconcileSpellAreaRegion(region, options);
  }
}

export async function reconcileSpellAreaRegion(region, options = {}) {
  const effect = await ensurePersistentEffectFlag(region);
  if (!effect) return [];

  const results = [];
  for (const token of region.parent?.tokens ?? []) {
    results.push(await reconcileTokenWithRegion(token, region, effect, options));
  }
  return results;
}

export async function reconcileSpellAreaToken(token, options = {}) {
  const results = [];
  for (const region of token?.parent?.regions ?? []) {
    const effect = await ensurePersistentEffectFlag(region);
    if (!effect) continue;
    results.push(await reconcileTokenWithRegion(token, region, effect, options));
  }
  return results;
}

async function reconcileTokenWithRegion(token, region, effect, { notify = false } = {}) {
  const actor = token?.actor;
  if (!actor) return null;

  const inside = !isExcludedSpellAreaCaster(region, token)
    && Boolean(token.testInsideRegion?.(region));
  const existing = findRegionEffectItems(actor, region.uuid);
  let changed = false;
  if (inside && existing.length === 0) {
    const itemData = buildEffectItemData(effect, region, token);
    try {
      await actor.createEmbeddedDocuments("Item", [itemData], { keepId: true });
    } catch (error) {
      if (!actor.items?.get(itemData._id)) throw error;
    }
    changed = true;
    if (notify) notifyAreaChange("Entered", token, region);
  } else if (!inside && existing.length > 0 && !actorHasTokenInsideRegion(actor, region)) {
    await actor.deleteEmbeddedDocuments("Item", existing.map(item => item.id));
    changed = true;
    if (notify) notifyAreaChange("Exited", token, region);
  }

  if (changed && typeof recalculateActor === "function") {
    await recalculateActor(actor, { witcherSpellAreaEffect: true });
  }
  await synchronizeAreaMessageTarget(region, token, inside);
  return { actor, inside, changed };
}

async function ensurePersistentEffectFlag(region) {
  const area = getAreaFlag(region);
  if (!area) return null;
  if (area.persistentEffect) return area.persistentEffect;

  const spell = area.spellUuid ? fromUuidSync(area.spellUuid) : null;
  const persistentEffect = buildPersistentSpellAreaEffect(spell, {
    staminaSpent: area.staminaSpent ?? 1,
  });
  if (!persistentEffect || !region?.update) return null;

  await region.update({ [`flags.${FLAG_SCOPE}.${FLAG_KEY}.persistentEffect`]: persistentEffect }, {
    witcherSpellAreaEffect: true,
  });
  return persistentEffect;
}

async function synchronizeAreaMessageTarget(region, token, inside) {
  const message = findAreaMessage(region);
  const area = message?.getFlag?.(FLAG_SCOPE, FLAG_KEY);
  const actor = token?.actor;
  if (!message || !area || !actor || !token.uuid) return;

  const existing = getSpellAreaTarget(area, token.uuid, actor.uuid);
  if (inside && !existing) {
    const target = createSpellAreaTargetState(area, {
      tokenUuid: token.uuid,
      actorUuid: actor.uuid,
      name: token.name ?? actor.name,
      img: token.texture?.src ?? actor.img ?? "icons/svg/mystery-man.svg",
    });
    await updateSpellAreaMessage(message, {
      areaPatch: { targets: [...(area.targets ?? []), target] },
    });
    return;
  }

  if (inside && existing) {
    await updateSpellAreaMessage(message, { areaPatch: {} });
    return;
  }

  if (!inside && existing && !actorHasTokenInsideRegion(actor, region)) {
    await updateSpellAreaMessage(message, {
      areaPatch: { targets: (area.targets ?? []).filter(target => target.actorUuid !== actor.uuid) },
    });
  }
}

async function removeTokenSpellAreaEffects(token) {
  const actor = token?.actor;
  if (!actor) return;
  let changed = false;
  for (const region of token.parent?.regions ?? []) {
    const existing = findRegionEffectItems(actor, region.uuid);
    if (!existing.length || actorHasTokenInsideRegion(actor, region, token.uuid)) continue;
    await actor.deleteEmbeddedDocuments("Item", existing.map(item => item.id));
    await synchronizeAreaMessageTarget(region, token, false);
    changed = true;
  }
  if (changed && typeof recalculateActor === "function") {
    await recalculateActor(actor, { witcherSpellAreaEffect: true });
  }
}

async function removeSpellAreaRegionEffects(region) {
  const actors = new Set();
  for (const token of region.parent?.tokens ?? []) {
    if (token.actor) actors.add(token.actor);
  }
  for (const actor of game.actors ?? []) actors.add(actor);

  for (const actor of actors) {
    const existing = findRegionEffectItems(actor, region.uuid);
    if (!existing.length) continue;
    await actor.deleteEmbeddedDocuments("Item", existing.map(item => item.id));
    if (typeof recalculateActor === "function") {
      await recalculateActor(actor, { witcherSpellAreaEffect: true });
    }
  }
}

async function finishSpellAreaRegion(region, reason) {
  await removeSpellAreaRegionEffects(region);
  const message = findAreaMessage(region);
  const area = message?.getFlag?.(FLAG_SCOPE, FLAG_KEY);
  if (message && area && !area.ended) {
    await updateSpellAreaMessage(message, {
      areaPatch: { ended: true, endReason: reason },
    });
  }

  if (reason === "expired") {
    ui.notifications.info(game.i18n.format("WITCHER.SpellArea.ExpiredNotice", {
      spell: region.name ?? "",
    }));
  }
}

function buildEffectItemData(effect, region, token) {
  return {
    _id: getRegionEffectItemId(region.uuid),
    name: game.i18n.format("WITCHER.SpellArea.EffectName", { spell: effect.name }),
    type: "effect",
    img: effect.img,
    system: {
      description: effect.description,
      isActive: true,
      isHud: false,
      stats: effect.stats,
      derived: effect.derived ?? [],
      skills: effect.skills ?? [],
    },
    flags: {
      [FLAG_SCOPE]: {
        [EFFECT_FLAG_KEY]: {
          key: effect.key,
          regionUuid: region.uuid,
          tokenUuid: token.uuid,
          penalty: effect.penalty,
        },
      },
    },
  };
}

function findRegionEffectItems(actor, regionUuid) {
  return Array.from(actor?.items ?? []).filter(item => (
    item.type === "effect"
    && item.getFlag?.(FLAG_SCOPE, EFFECT_FLAG_KEY)?.regionUuid === regionUuid
  ));
}

function actorHasTokenInsideRegion(actor, region, excludedTokenUuid = null) {
  return Array.from(region.parent?.tokens ?? []).some(token => (
    token.uuid !== excludedTokenUuid
    && token.actor?.uuid === actor.uuid
    && !isExcludedSpellAreaCaster(region, token)
    && token.testInsideRegion?.(region)
  ));
}

function findAreaMessage(region) {
  const areaFlag = getAreaFlag(region);
  const byId = areaFlag?.messageId ? game.messages?.get(areaFlag.messageId) : null;
  if (byId) return byId;
  const messages = game.messages?.contents ?? Array.from(game.messages ?? []);
  return [...messages].reverse().find(message => (
    message.getFlag?.(FLAG_SCOPE, FLAG_KEY)?.regionUuid === region.uuid
  )) ?? null;
}

function getAreaFlag(region) {
  return region?.getFlag?.(FLAG_SCOPE, FLAG_KEY)
    ?? region?.flags?.[FLAG_SCOPE]?.[FLAG_KEY]
    ?? null;
}

function notifyAreaChange(action, token, region) {
  ui.notifications.info(game.i18n.format(`WITCHER.SpellArea.${action}`, {
    target: token.name ?? token.actor?.name ?? "",
    spell: region.name ?? "",
  }));
}

function tokenChangeAffectsArea(changes) {
  return ["x", "y", "elevation", "width", "height", "shape", "level"].some(key => key in (changes ?? {}));
}

function regionChangeAffectsArea(changes) {
  if (changes?.flags?.[FLAG_SCOPE]?.[FLAG_KEY]?.persistentEffect) return false;
  return ["shapes", "levels", "hidden", "disabled"].some(key => key in (changes ?? {}));
}

function chatMessageChangeAffectsSpellArea(changes) {
  return Boolean(
    changes?.flags?.[FLAG_SCOPE]?.[FLAG_KEY]
    || Object.hasOwn(changes ?? {}, `flags.${FLAG_SCOPE}.${FLAG_KEY}`)
  );
}

function isSpellAreaLifecycleClient(region) {
  const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  const explicitOwners = Object.entries(region?.ownership ?? {})
    .filter(([userId, level]) => userId !== "default" && Number(level) >= ownerLevel)
    .map(([userId]) => game.users?.get?.(userId))
    .filter(user => user?.active)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  if (explicitOwners.length) return explicitOwners[0].id === game.user?.id;

  const activeGms = Array.from(game.users ?? [])
    .filter(user => user.active && user.isGM)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  if (activeGms.length) return activeGms[0].id === game.user?.id;
  return Boolean(region?.isOwner);
}

function isOriginatingClient(userId) {
  return !userId || userId === game.user?.id;
}

function getRegionEffectItemId(regionUuid) {
  const source = String(regionUuid ?? "spell-area");
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619) >>> 0;
    second = Math.imul(second ^ code, 3266489917) >>> 0;
  }
  return `wa${first.toString(36).padStart(7, "0")}${second.toString(36).padStart(7, "0")}`.slice(0, 16);
}
