import {
  getDamageStatusDurationRounds,
  initializeStatusLifecycle,
} from "./ongoingStatusEffects.mjs";

const statusItemQueues = new WeakMap();
let recalculateActor = null;

export function resolveDamageEffects(effects, rollPercentage = randomPercentage) {
  if (!Array.isArray(effects)) return [];

  return effects.map(effect => {
    const percentage = normalizePercentage(effect?.percentage);
    const roll = percentage > 0 ? normalizeRoll(rollPercentage()) : null;

    return {
      ...effect,
      percentage,
      roll,
      success: percentage === 0 || roll <= percentage,
    };
  });
}

export function prepareDamageEffects(effects, statusEffects, localize = value => value) {
  if (!Array.isArray(effects)) return [];

  return effects.map(effect => {
    if (effect?.statusEffect || !effect?.name) return effect;

    const effectName = normalizeName(effect.name);
    const aliasStatusId = getLegacyStatusEffectId(effectName);
    const matchedStatus = (statusEffects ?? []).find(status => {
      if (aliasStatusId && status.id === aliasStatusId) return true;
      const candidates = [status.id, status.name, status.label]
        .filter(Boolean)
        .flatMap(value => [value, localize(value)]);
      return candidates.some(candidate => normalizeName(candidate) === effectName);
    });

    return matchedStatus ? { ...effect, statusEffect: matchedStatus.id } : effect;
  });
}

function getLegacyStatusEffectId(effectName) {
  const aliases = {
    burning: "fire",
    fire: "fire",
    frozen: "freeze",
    freeze: "freeze",
    knockdown: "prone",
    prone: "prone",
    stagger: "staggered",
    staggered: "staggered",
    stun: "stun",
    suffocate: "suffocation",
    suffocation: "suffocation",
  };
  const simpleName = effectName.replace(/\s*\([^)]*\)\s*$/, "");
  return aliases[simpleName] ?? null;
}

export function getSuccessfulStatusEffectIds(damage) {
  const effects = Array.isArray(damage?.resolvedEffects) ? damage.resolvedEffects : [];
  return [...new Set(
    effects
      .filter(effect => effect?.success === true && effect.statusEffect)
      .map(effect => effect.statusEffect),
  )];
}

export async function applySuccessfulDamageStatusEffects(actor, damage, options = {}) {
  if (!actor?.toggleStatusEffect) return [];

  const results = [];
  for (const statusId of getSuccessfulStatusEffectIds(damage)) {
    const statusEffects = options.statusEffects ?? getConfiguredStatusEffects();
    const durationRounds = getDamageStatusDurationRounds(statusId, damage, statusEffects);
    if (actor.statuses?.has(statusId)) {
      const systemEffect = await ensureDamageStatusEffectItem(actor, statusId, damage, options);
      await initializeStatusLifecycle(actor, statusId, { durationRounds });
      results.push({ statusId, applied: false, alreadyActive: true, systemEffect });
      continue;
    }

    await actor.toggleStatusEffect(statusId, { active: true });
    const immune = actor.system?.statusEffectImmunities?.includes(statusId) ?? false;
    const systemEffect = immune
      ? null
      : await ensureDamageStatusEffectItem(actor, statusId, damage, options);
    if (!immune) await initializeStatusLifecycle(actor, statusId, { durationRounds });
    results.push({ statusId, applied: !immune, immune, systemEffect });

    if (immune) {
      setTimeout(() => {
        Promise.resolve(actor.toggleStatusEffect(statusId, { active: false }))
          .catch(error => console.warn("TheWitcherTRPG | Could not remove resisted status effect.", error));
      }, 1000);
    }
  }

  return results;
}

export async function ensureDamageStatusEffectItem(actor, statusId, damage, options = {}) {
  if (!actor?.createEmbeddedDocuments) return null;
  return enqueueStatusItemOperation(actor, statusId, () => (
    ensureDamageStatusEffectItemInternal(actor, statusId, damage, options)
  ));
}

async function ensureDamageStatusEffectItemInternal(actor, statusId, damage, options = {}) {

  const statusEffects = options.statusEffects ?? getConfiguredStatusEffects();
  const localize = options.localize ?? getLocalize();
  const status = findStatusEffect(statusEffects, statusId);
  const label = localize(status?.name ?? status?.label ?? statusId);
  const existing = Array.from(actor.items ?? []).find(item => (
    item?.type === "effect"
    && (getStatusEffectFlag(item) === statusId || normalizeName(item.name) === normalizeName(label))
  ));

  if (existing) {
    const updates = {};
    if (!existing.system?.isActive) updates["system.isActive"] = true;
    if (getStatusEffectFlag(existing) !== statusId) {
      updates["flags.thewitchertrpg.statusEffectId"] = statusId;
      updates["flags.thewitchertrpg.appliedByDamage"] = true;
    }
    if (Object.keys(updates).length > 0 && existing.update) {
      await existing.update(updates);
    }
    return { created: false, item: existing };
  }

  const effectTemplates = options.effectTemplates ?? globalThis.game?.items ?? [];
  const template = Array.from(effectTemplates).find(item => (
    item?.type === "effect"
    && (getStatusEffectFlag(item) === statusId || normalizeName(item.name) === normalizeName(label))
  ));
  const itemData = buildDamageStatusEffectItemData(statusId, damage, statusEffects, {
    idFactory: options.idFactory,
    localize,
    template,
  });
  const created = await actor.createEmbeddedDocuments("Item", [itemData]);
  return { created: true, item: created?.[0] ?? null };
}

export function registerDamageStatusEffectSyncHooks(hooks = globalThis.Hooks, updateDerived = null) {
  if (!hooks?.on) return;
  recalculateActor = updateDerived;

  hooks.on("createActiveEffect", synchronizeCreatedNativeStatusEffect);
  hooks.on("deleteItem", synchronizeDeletedDamageEffectItem);
  hooks.on("deleteActiveEffect", synchronizeDeletedNativeStatusEffect);
}

export async function synchronizeCreatedNativeStatusEffect(effect, _options = {}, userId = null) {
  if (!isOriginatingClient(userId)) return [];

  const actor = effect?.parent ?? effect?.actor;
  if (!actor?.createEmbeddedDocuments) return [];
  const configuredStatuses = getConfiguredStatusEffects();
  const results = [];
  for (const statusId of getNativeStatusEffectIds(effect)) {
    if (!findStatusEffect(configuredStatuses, statusId)) continue;
    results.push(await ensureDamageStatusEffectItem(actor, statusId, { resolvedEffects: [] }));
  }
  if (results.length && typeof recalculateActor === "function") {
    await recalculateActor(actor, { witcherStatusEffect: true });
  }
  return results;
}

export async function synchronizeDeletedDamageEffectItem(item, _options = {}, userId = null) {
  if (!isOriginatingClient(userId) || item?.type !== "effect") return false;

  const statusId = getStatusEffectFlag(item);
  const actor = item?.parent ?? item?.actor;
  if (!statusId || !actor?.toggleStatusEffect || !actor.statuses?.has(statusId)) return false;

  await actor.toggleStatusEffect(statusId, { active: false });
  if (typeof recalculateActor === "function") {
    await recalculateActor(actor, { witcherStatusEffect: true });
  }
  return true;
}

export async function synchronizeDeletedNativeStatusEffect(effect, _options = {}, userId = null) {
  if (!isOriginatingClient(userId)) return [];

  const actor = effect?.parent ?? effect?.actor;
  if (!actor?.items) return [];

  const statusIds = getNativeStatusEffectIds(effect);
  if (statusIds.length === 0) return [];

  const linkedItems = Array.from(actor.items).filter(item => (
    item?.type === "effect" && statusIds.includes(getStatusEffectFlag(item))
  ));
  const deletedItemIds = [];
  for (const item of linkedItems) {
    if (!item?.delete) continue;
    await item.delete();
    deletedItemIds.push(item.id ?? item._id);
  }
  if (deletedItemIds.length && typeof recalculateActor === "function") {
    await recalculateActor(actor, { witcherStatusEffect: true });
  }
  return deletedItemIds;
}

export function buildDamageStatusEffectItemData(statusId, damage, statusEffects, options = {}) {
  const localize = options.localize ?? (value => value);
  const idFactory = options.idFactory ?? createId;
  const status = findStatusEffect(statusEffects, statusId) ?? { id: statusId, label: statusId };
  const sourceEffect = (damage?.resolvedEffects ?? []).find(effect => effect?.statusEffect === statusId) ?? {};
  const templateSystem = options.template?.system ?? {};
  const statusSystem = status.systemEffect ?? {};
  const sourceSystem = sourceEffect.systemEffect ?? {};
  const label = localize(status.name ?? status.label ?? sourceEffect.name ?? statusId);
  const description = sourceSystem.description
    ?? statusSystem.description
    ?? templateSystem.description
    ?? sourceEffect.description
    ?? "";

  return {
    name: label,
    type: "effect",
    img: status.img ?? status.icon ?? options.template?.img ?? "icons/svg/aura.svg",
    system: {
      description: localize(description),
      isActive: true,
      isHud: true,
      stats: normalizeModifiers(sourceSystem.stats ?? sourceEffect.stats ?? statusSystem.stats ?? templateSystem.stats, "stat", idFactory),
      derived: normalizeModifiers(sourceSystem.derived ?? sourceEffect.derived ?? statusSystem.derived ?? templateSystem.derived, "derivedStat", idFactory),
      skills: normalizeModifiers(sourceSystem.skills ?? sourceEffect.skills ?? statusSystem.skills ?? templateSystem.skills, "skill", idFactory),
    },
    flags: {
      thewitchertrpg: {
        statusEffectId: statusId,
        appliedByDamage: true,
      },
    },
  };
}

function normalizePercentage(value) {
  const percentage = Number(value);
  if (!Number.isFinite(percentage)) return 0;
  return Math.min(100, Math.max(0, percentage));
}

function normalizeRoll(value) {
  const roll = Number(value);
  if (!Number.isFinite(roll)) return 100;
  return Math.min(100, Math.max(1, Math.floor(roll)));
}

function randomPercentage() {
  return Math.floor(Math.random() * 100) + 1;
}

function getConfiguredStatusEffects() {
  return globalThis.CONFIG?.WITCHER?.statusEffects ?? globalThis.CONFIG?.statusEffects ?? [];
}

function findStatusEffect(statusEffects, statusId) {
  const effects = Array.isArray(statusEffects) ? statusEffects : Object.values(statusEffects ?? {});
  return effects.find(effect => effect?.id === statusId);
}

function getStatusEffectFlag(item) {
  return item?.getFlag?.("thewitchertrpg", "statusEffectId")
    ?? item?.flags?.thewitchertrpg?.statusEffectId
    ?? null;
}

function getNativeStatusEffectIds(effect) {
  const statuses = effect?.statuses ?? effect?._source?.statuses ?? [];
  const legacyStatusId = effect?.getFlag?.("core", "statusId")
    ?? effect?.flags?.core?.statusId
    ?? null;
  return [...new Set([
    ...Array.from(statuses ?? []),
    legacyStatusId,
  ].filter(Boolean))];
}

function isOriginatingClient(userId) {
  const currentUserId = globalThis.game?.user?.id;
  return !userId || !currentUserId || userId === currentUserId;
}

function normalizeModifiers(modifiers, field, idFactory) {
  if (!Array.isArray(modifiers)) return [];

  return modifiers
    .filter(modifier => modifier?.[field] && modifier?.modifier !== undefined)
    .map(modifier => ({
      id: modifier.id || idFactory(),
      modifier: String(modifier.modifier),
      [field]: modifier[field],
    }));
}

function getLocalize() {
  return value => globalThis.game?.i18n?.localize?.(value) ?? value;
}

function createId() {
  return globalThis.foundry?.utils?.randomID?.(16)
    ?? globalThis.randomID?.(16)
    ?? Math.random().toString(36).slice(2, 18);
}

function normalizeName(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function enqueueStatusItemOperation(actor, statusId, operation) {
  let actorQueues = statusItemQueues.get(actor);
  if (!actorQueues) {
    actorQueues = new Map();
    statusItemQueues.set(actor, actorQueues);
  }
  const previous = actorQueues.get(statusId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  actorQueues.set(statusId, next);
  return next.finally(() => {
    if (actorQueues.get(statusId) === next) actorQueues.delete(statusId);
    if (actorQueues.size === 0) statusItemQueues.delete(actor);
  });
}
