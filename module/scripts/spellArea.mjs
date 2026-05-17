const SPELL_AREA_START = "<!-- witcher-spell-area-start -->";
const SPELL_AREA_END = "<!-- witcher-spell-area-end -->";

export function normalizeSpellAreaSize(value) {
  const match = String(value ?? "").trim().replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  const size = Number(match?.[0]);
  return Number.isFinite(size) && size > 0 ? size : null;
}

export function parseSpellAreaDurationRounds(value) {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const match = normalized.match(/(\d+)\s*(?:rounds?|rund(?:a|y|e)?)/i);
  const rounds = Number(match?.[1]);
  return Number.isInteger(rounds) && rounds > 0 ? rounds : null;
}

export function buildSpellAreaDurationData(duration, combat = null) {
  const durationRounds = parseSpellAreaDurationRounds(duration);
  const combatRound = Number(combat?.round);
  const hasCombatStart = durationRounds
    && combat?.id
    && Number.isInteger(combatRound)
    && combatRound > 0;
  const startRound = hasCombatStart ? combatRound : null;
  return {
    durationRounds,
    combatId: hasCombatStart ? combat.id : null,
    startRound,
    expirationRound: hasCombatStart ? startRound + durationRounds : null,
  };
}

export function getSpellAreaExpirationState(area, combat = null) {
  const durationRounds = Number(area?.durationRounds);
  const expirationRound = Number(area?.expirationRound);
  const combatRound = Number(combat?.round);
  const tracked = Number.isInteger(durationRounds)
    && durationRounds > 0
    && Boolean(area?.combatId)
    && area.combatId === combat?.id
    && Number.isInteger(expirationRound)
    && Number.isInteger(combatRound)
    && combatRound > 0;
  if (!tracked) {
    return { tracked: false, expired: false, remainingRounds: null };
  }

  return {
    tracked: true,
    expired: combatRound >= expirationRound,
    remainingRounds: Math.max(0, Math.min(durationRounds, expirationRound - combatRound)),
  };
}

export function buildPersistentSpellAreaEffect(spell, { staminaSpent = 1 } = {}) {
  const explicitKey = spell?.flags?.thewitchertrpg?.spellAreaEffectKey
    ?? spell?.getFlag?.("thewitchertrpg", "spellAreaEffectKey")
    ?? null;
  const key = explicitKey ?? normalizeSpellName(spell?.name);
  if (key !== "yrden") return null;

  const spent = Math.max(1, Math.floor(Number(staminaSpent) || 1));
  const penalty = Math.min(4, 1 + Math.floor((spent - 1) / 2));
  return {
    version: 1,
    key,
    name: spell?.name ?? "Yrden",
    img: spell?.img ?? "icons/svg/aura.svg",
    description: spell?.system?.effect ?? "",
    excludeCaster: true,
    penalty,
    stats: [
      { id: "yrden-ref", stat: "WITCHER.Actor.Stat.Ref", modifier: `-${penalty}` },
      { id: "yrden-spd", stat: "WITCHER.Actor.Stat.Spd", modifier: `-${penalty}` },
    ],
    derived: [],
    skills: [],
  };
}

export function isExcludedSpellAreaCaster(region, token, casterToken = null) {
  const area = getRegionSpellAreaFlag(region);
  const effectKey = area?.persistentEffect?.key ?? null;
  const excludesCaster = area?.excludeCaster
    ?? area?.persistentEffect?.excludeCaster
    ?? effectKey === "yrden";
  if (!excludesCaster) return false;

  const document = token?.document ?? token;
  const actor = document?.actor ?? token?.actor;
  const suppliedCasterDocument = casterToken?.document ?? casterToken;
  const suppliedCasterActor = suppliedCasterDocument?.actor ?? casterToken?.actor;
  const casterTokenUuid = area?.casterTokenUuid ?? suppliedCasterDocument?.uuid ?? null;
  const casterActorUuid = area?.actorUuid ?? suppliedCasterActor?.uuid ?? null;
  return Boolean(
    (casterTokenUuid && document?.uuid === casterTokenUuid)
    || (casterActorUuid && actor?.uuid === casterActorUuid)
  );
}

export function buildSpellAreaShape(templateType, sizePixels, { rotation = 0, gridPixels = 1 } = {}) {
  const size = Number(sizePixels);
  if (!Number.isFinite(size) || size <= 0) return null;

  switch (templateType) {
    case "rect":
      return {
        type: "rectangle",
        x: 0,
        y: 0,
        width: size,
        height: size,
        rotation: 45,
        anchorX: 0.5,
        anchorY: 0.5,
        gridBased: true,
      };
    case "cone":
      return {
        type: "cone",
        x: 0,
        y: 0,
        radius: size,
        angle: 45,
        rotation,
        gridBased: true,
      };
    case "ray":
      return {
        type: "rectangle",
        x: 0,
        y: 0,
        width: size,
        height: gridPixels,
        rotation,
        anchorX: 0,
        anchorY: 0.5,
        gridBased: true,
      };
    case "circle":
    default:
      return {
        type: "circle",
        x: 0,
        y: 0,
        radius: size,
        gridBased: true,
      };
  }
}

export function collectSpellAreaTargets(region, casterToken = null) {
  const casterActorUuid = casterToken?.actor?.uuid ?? casterToken?.document?.actor?.uuid ?? null;
  const sceneTokens = Array.from(region?.parent?.tokens ?? []);
  const tokens = sceneTokens.length
    ? sceneTokens.filter(token => token.testInsideRegion?.(region))
    : Array.from(region?.tokens ?? []);
  const actors = new Set();

  return tokens
    .map(token => {
      const document = token?.document ?? token;
      const actor = document?.actor ?? token?.actor;
      const actorUuid = actor?.uuid ?? null;
      if (isExcludedSpellAreaCaster(region, token, casterToken)) return null;
      if (!document?.uuid || !actorUuid || actors.has(actorUuid)) return null;
      actors.add(actorUuid);

      return {
        tokenUuid: document.uuid,
        actorUuid,
        name: document.name ?? actor.name,
        img: document.texture?.src ?? actor.img ?? "icons/svg/mystery-man.svg",
        isCaster: actorUuid === casterActorUuid,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getRegionSpellAreaFlag(region) {
  return region?.getFlag?.("thewitchertrpg", "spellArea")
    ?? region?.flags?.thewitchertrpg?.spellArea
    ?? null;
}

export function createSpellAreaResolution({
  region,
  casterToken,
  spell,
  targets = [],
  attackTotal,
  defence = "",
  hasDefence = false,
  hasDamage = false,
}) {
  const duration = getRegionSpellAreaFlag(region) ?? {};
  const initialState = hasDefence ? "pending" : (hasDamage ? "ready" : "affected");
  return {
    version: 1,
    regionId: region?.id ?? null,
    regionUuid: region?.uuid ?? null,
    casterTokenUuid: casterToken?.document?.uuid ?? casterToken?.uuid ?? null,
    spellUuid: spell?.uuid ?? null,
    spellName: spell?.name ?? "",
    attackTotal: Number(attackTotal),
    defence,
    hasDefence: Boolean(hasDefence),
    hasDamage: Boolean(hasDamage),
    baseDamageTotal: null,
    baseDamageMessageId: null,
    durationRounds: duration.durationRounds ?? null,
    combatId: duration.combatId ?? null,
    startRound: duration.startRound ?? null,
    expirationRound: duration.expirationRound ?? null,
    ended: false,
    endReason: null,
    targets: targets.map(target => ({
      tokenUuid: target.tokenUuid,
      actorUuid: target.actorUuid,
      name: target.name,
      img: target.img,
      state: initialState,
      defenceResolution: null,
      damageMessageId: null,
    })),
  };
}

export function createSpellAreaTargetState(area, target) {
  const state = area?.hasDefence ? "pending" : (area?.hasDamage ? "ready" : "affected");
  return {
    tokenUuid: target.tokenUuid,
    actorUuid: target.actorUuid,
    name: target.name,
    img: target.img,
    state,
    defenceResolution: null,
    damageMessageId: null,
  };
}

export function getSpellAreaTarget(area, tokenUuid, actorUuid = null) {
  return area?.targets?.find(target => target.tokenUuid === tokenUuid)
    ?? area?.targets?.find(target => actorUuid && target.actorUuid === actorUuid)
    ?? null;
}

export function updateSpellAreaTargetData(area, tokenUuid, patch, actorUuid = null) {
  if (!getSpellAreaTarget(area, tokenUuid, actorUuid)) return area;
  return {
    ...area,
    targets: area.targets.map(target => {
      const matches = target.tokenUuid === tokenUuid || (actorUuid && target.actorUuid === actorUuid);
      return matches ? { ...target, ...patch } : target;
    }),
  };
}

export function isSpellAreaDamageReady(target) {
  return ["ready", "hit", "rolled"].includes(target?.state);
}

export function isSpellAreaResolutionComplete(area) {
  if (!area || area.ended) return false;
  const targets = Array.isArray(area.targets) ? area.targets : [];
  return targets.every(target => ["defended", "affected", "applied"].includes(target?.state));
}

export function renderSpellAreaResolution(area, i18n = null) {
  if (!area) return "";
  const localize = key => i18n?.localize?.(key) ?? key;
  const format = (key, data) => i18n?.format?.(key, data) ?? localize(key);
  const targets = area.targets ?? [];
  const isEnded = Boolean(area.ended);
  const readyTargets = targets.filter(target => !isEnded && area.hasDamage && isSpellAreaDamageReady(target));
  const rows = targets.map(target => {
    const state = getTargetStateDisplay(target, localize, format);
    let action = "";
    if (!isEnded && target.state === "pending") {
      action = `<button type="button" class="spell-area-defence" data-target-token-uuid="${escapeHtml(target.tokenUuid)}" title="${escapeHtml(localize("WITCHER.SpellArea.Defend"))}">
        <i class="fas fa-shield-alt" aria-hidden="true"></i><span>${escapeHtml(localize("WITCHER.SpellArea.Defend"))}</span>
      </button>`;
    } else if (!isEnded && area.hasDamage && isSpellAreaDamageReady(target)) {
      action = `<button type="button" class="spell-area-damage" data-target-token-uuid="${escapeHtml(target.tokenUuid)}" title="${escapeHtml(localize("WITCHER.SpellArea.Resolve"))}">
        <i class="fas fa-heart-broken" aria-hidden="true"></i><span>${escapeHtml(localize("WITCHER.SpellArea.Resolve"))}</span>
      </button>`;
    }

    return `<div class="spell-area-target is-${escapeHtml(target.state)}">
      <img src="${escapeHtml(target.img)}" alt="" />
      <div class="spell-area-target-summary">
        <strong>${escapeHtml(target.name)}</strong>
        <span>${state}</span>
      </div>
      <div class="spell-area-target-action">${action}</div>
    </div>`;
  }).join("");
  const empty = targets.length ? "" : `<p class="spell-area-empty">${escapeHtml(localize("WITCHER.SpellArea.NoTargets"))}</p>`;
  const resolveAll = readyTargets.length > 1 ? `<button type="button" class="spell-area-resolve-all">
    <i class="fas fa-users" aria-hidden="true"></i><span>${escapeHtml(localize("WITCHER.SpellArea.ResolveAll"))}</span>
  </button>` : "";
  const endArea = !isEnded && area.regionUuid ? `<button type="button" class="spell-area-end secondary">
    <i class="fas fa-ban" aria-hidden="true"></i><span>${escapeHtml(localize("WITCHER.SpellArea.End"))}</span>
  </button>` : "";
  const duration = renderSpellAreaDuration(area, localize, format);
  const status = isEnded ? `<p class="spell-area-status is-ended">
    <i class="fas fa-hourglass-end" aria-hidden="true"></i><span>${escapeHtml(localize(
      area.endReason === "expired"
        ? "WITCHER.SpellArea.Expired"
        : (area.endReason === "resolved" ? "WITCHER.SpellArea.Resolved" : "WITCHER.SpellArea.Ended"),
    ))}</span>
  </p>` : duration;
  const actions = [resolveAll, endArea].filter(Boolean).join("");

  return `${SPELL_AREA_START}
    <section class="spell-area-resolution" data-spell-area>
      <header>
        <div><i class="fas fa-bullseye" aria-hidden="true"></i><strong>${escapeHtml(localize("WITCHER.SpellArea.Targets"))}</strong></div>
        <span>${targets.length}</span>
      </header>
      ${status}
      <div class="spell-area-targets">${rows}${empty}</div>
      ${actions ? `<div class="spell-area-actions">${actions}</div>` : ""}
    </section>
  ${SPELL_AREA_END}`;
}

function renderSpellAreaDuration(area, localize, format) {
  const durationRounds = Number(area?.durationRounds);
  if (!Number.isInteger(durationRounds) || durationRounds <= 0) return "";
  const expirationRound = Number(area?.expirationRound);
  const hasExpirationRound = area?.expirationRound !== null
    && area?.expirationRound !== undefined
    && Number.isInteger(expirationRound)
    && expirationRound > 0;
  const key = hasExpirationRound
    ? "WITCHER.SpellArea.DurationTracked"
    : "WITCHER.SpellArea.DurationManual";
  const label = format(key, { rounds: durationRounds, round: expirationRound });
  return `<p class="spell-area-status">
    <i class="fas fa-hourglass-half" aria-hidden="true"></i><span>${escapeHtml(label)}</span>
  </p>`;
}

export function replaceSpellAreaResolution(flavor, area, i18n = null) {
  const rendered = renderSpellAreaResolution(area, i18n);
  const source = String(flavor ?? "");
  const withoutMarkers = source
    .replaceAll(SPELL_AREA_START, "")
    .replaceAll(SPELL_AREA_END, "");
  const withoutPreviousSections = withoutMarkers.replace(
    /<section\s+class="spell-area-resolution"[^>]*>[\s\S]*?<\/section>/g,
    "",
  );
  return `${withoutPreviousSections}${rendered}`;
}

export async function updateSpellAreaMessage(message, { tokenUuid, actorUuid = null, targetPatch = {}, areaPatch = {} }) {
  const area = message?.getFlag?.("thewitchertrpg", "spellArea");
  if (!area) return null;
  const updatedTargetArea = tokenUuid
    ? updateSpellAreaTargetData(area, tokenUuid, targetPatch, actorUuid)
    : area;
  const updatedArea = { ...updatedTargetArea, ...areaPatch };
  await message.update({
    flavor: replaceSpellAreaResolution(message.flavor, updatedArea, game.i18n),
    "flags.thewitchertrpg.spellArea": updatedArea,
  });
  return updatedArea;
}

export async function updateSpellAreaTargetDefence(attackMessageId, targetTokenUuid, defenceResolution) {
  const attackMessage = game.messages?.get(attackMessageId);
  const area = attackMessage?.getFlag?.("thewitchertrpg", "spellArea");
  const target = getSpellAreaTarget(area, targetTokenUuid, defenceResolution?.targetActorUuid);
  if (!attackMessage || !area || !target) return null;

  const hit = Number(defenceResolution?.margin) > 0;
  const state = hit ? (area.hasDamage ? "hit" : "affected") : "defended";
  return updateSpellAreaMessage(attackMessage, {
    tokenUuid: target.tokenUuid,
    actorUuid: target.actorUuid,
    targetPatch: { state, defenceResolution: cloneData(defenceResolution) },
    areaPatch: area.ended ? { ended: false, endReason: null } : {},
  });
}

function getTargetStateDisplay(target, localize, format) {
  switch (target.state) {
    case "hit":
      return format("WITCHER.SpellArea.Hit", { margin: target.defenceResolution?.margin ?? 0 });
    case "ready": return localize("WITCHER.SpellArea.Ready");
    case "defended": return localize("WITCHER.SpellArea.Defended");
    case "affected": return localize("WITCHER.SpellArea.Affected");
    case "rolling": return localize("WITCHER.SpellArea.Rolling");
    case "rolled": return localize("WITCHER.SpellArea.Rolled");
    case "applied": return localize("WITCHER.SpellArea.Applied");
    case "failed": return localize("WITCHER.SpellArea.Failed");
    case "pending":
    default:
      return localize("WITCHER.SpellArea.Pending");
  }
}

function cloneData(value) {
  return globalThis.foundry?.utils?.deepClone?.(value)
    ?? JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function normalizeSpellName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
