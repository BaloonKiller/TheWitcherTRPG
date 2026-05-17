const FLAG_SCOPE = "thewitchertrpg";
const LIFECYCLE_FLAG = "statusLifecycles";
const lifecycleQueues = new WeakMap();

export const DEFAULT_ONGOING_STATUS_RULES = Object.freeze({
  bleed: Object.freeze({ damage: 2, ignoresArmor: true }),
  poison: Object.freeze({ damage: 3, ignoresArmor: true }),
  suffocation: Object.freeze({ damage: 3, ignoresArmor: true }),
  fire: Object.freeze({ damage: 5, fireLocations: true }),
  staggered: Object.freeze({ expiresAtNextTurnStart: true }),
});

export function parseStatusDurationRounds(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  const normalized = String(value).trim();
  if (!normalized || /immediate|instant|natychmiast/i.test(normalized)) return null;
  const match = normalized.match(/(?:^|\D)(\d+)\s*(?:rounds?|rnds?|rund(?:a|y|ę)?)(?:\D|$)/i);
  const rounds = Number(match?.[1]);
  return Number.isInteger(rounds) && rounds > 0 ? rounds : null;
}

export function getDamageStatusDurationRounds(statusId, damage, statusEffects = []) {
  const status = findStatusEffect(statusEffects, statusId);
  const sourceEffect = (damage?.resolvedEffects ?? []).find(effect => effect?.statusEffect === statusId) ?? {};
  const candidates = [
    sourceEffect.durationRounds,
    sourceEffect.systemEffect?.durationRounds,
    status?.ongoingEffect?.durationRounds,
    status?.systemEffect?.durationRounds,
    damage?.durationRounds,
    damage?.duration,
  ];
  for (const candidate of candidates) {
    const rounds = parseStatusDurationRounds(candidate);
    if (rounds) return rounds;
  }
  return null;
}

export function buildInitialStatusLifecycle(statusId, combat = null, options = {}) {
  const configuredDuration = parseStatusDurationRounds(options.durationRounds);
  const defaultDuration = DEFAULT_ONGOING_STATUS_RULES[statusId]?.expiresAtNextTurnStart ? 1 : null;
  return {
    statusId,
    combatId: combat?.id ?? null,
    appliedRound: normalizePositiveInteger(combat?.round),
    appliedTurn: normalizeNonNegativeInteger(combat?.turn),
    appliedCombatantId: getCurrentCombatant(combat)?.id ?? null,
    remainingRounds: configuredDuration ?? defaultDuration,
    lastProcessedTurnKey: null,
    appliedAt: Number(options.appliedAt) || Date.now(),
  };
}

export function getCombatTurnKey(combat) {
  const combatId = combat?.id;
  const round = normalizePositiveInteger(combat?.round);
  const turn = normalizeNonNegativeInteger(combat?.turn);
  const combatantId = getCurrentCombatant(combat)?.id;
  if (!combatId || round === null || turn === null || !combatantId) return null;
  return `${combatId}:${round}:${turn}:${combatantId}`;
}

export function getStatusTurnPlan(statusId, lifecycle, combat) {
  const rule = DEFAULT_ONGOING_STATUS_RULES[statusId] ?? {};
  const turnKey = getCombatTurnKey(combat);
  if (!turnKey || lifecycle?.lastProcessedTurnKey === turnKey) {
    return { process: false, turnKey };
  }

  const appliedThisTurn = lifecycle?.combatId === combat?.id
    && lifecycle?.appliedRound === normalizePositiveInteger(combat?.round)
    && lifecycle?.appliedTurn === normalizeNonNegativeInteger(combat?.turn)
    && lifecycle?.appliedCombatantId === getCurrentCombatant(combat)?.id;
  if (appliedThisTurn) {
    return { process: false, turnKey, appliedThisTurn: true };
  }

  if (rule.expiresAtNextTurnStart) {
    return { process: true, turnKey, expireBeforeTick: true, remainingRounds: 0 };
  }

  const currentRemaining = parseStatusDurationRounds(lifecycle?.remainingRounds);
  const remainingRounds = currentRemaining === null ? null : Math.max(0, currentRemaining - 1);
  return {
    process: true,
    turnKey,
    tick: Boolean(rule.damage),
    remainingRounds,
    expireAfterTick: remainingRounds === 0,
    rule,
  };
}

export function calculateStackedArmorSp(lightArmorSP, mediumArmorSP, heavyArmorSP) {
  const light = normalizeSp(lightArmorSP);
  const medium = normalizeSp(mediumArmorSP);
  const heavy = normalizeSp(heavyArmorSP);
  let total = 0;

  if (heavy > 0) total = heavy;
  if (medium > 0) total = total > 0 ? total + getArmorDifferenceBonus(heavy, medium) : medium;
  if (light > 0) {
    const outer = medium > 0 ? medium : heavy;
    total = total > 0 ? total + getArmorDifferenceBonus(outer, light) : light;
  }
  return total;
}

export function resolveFireLocationDamage(baseDamage, stoppingPower, resistant = false) {
  const afterArmor = Math.max(0, normalizeSp(baseDamage) - Math.max(0, normalizeSp(stoppingPower)));
  return Math.floor(resistant ? afterArmor / 2 : afterArmor);
}

export function getOngoingStatusDamage(actor, statusId, baseDamage) {
  let damage = Math.max(0, Math.floor(Number(baseDamage) || 0));
  if (statusId !== "bleed") return damage;

  const wounds = Array.isArray(actor?.system?.critWounds)
    ? actor.system.critWounds
    : Object.values(actor?.system?.critWounds ?? {});
  const damagedHeartWounds = wounds.filter(wound => (
    wound?.effect === "DeadlyHearthDamage" && wound?.mod === "Treated"
  )).length;
  damage += damagedHeartWounds * 2;
  return damage;
}

export function registerOngoingStatusEffectHooks(hooks = globalThis.Hooks) {
  if (!hooks?.on) return;

  hooks.on("createActiveEffect", (effect, _options, userId) => {
    if (!isOriginatingClient(userId)) return;
    const actor = effect?.parent ?? effect?.actor;
    for (const statusId of getNativeStatusEffectIds(effect)) {
      const durationRounds = getConfiguredStatusDurationRounds(statusId);
      if (DEFAULT_ONGOING_STATUS_RULES[statusId] || durationRounds) {
        void initializeStatusLifecycle(actor, statusId, { durationRounds });
      }
    }
  });
  hooks.on("deleteActiveEffect", (effect, _options, userId) => {
    if (!isOriginatingClient(userId)) return;
    const actor = effect?.parent ?? effect?.actor;
    for (const statusId of getNativeStatusEffectIds(effect)) {
      void removeStatusLifecycle(actor, statusId);
    }
  });
  hooks.on("updateCombat", (combat, changes, _options, userId) => {
    if (!combatChangeStartsTurn(changes) || !isStatusLifecycleAuthority(userId)) return;
    void processCurrentCombatantStatusEffects(combat);
  });
  hooks.on("combatStart", combat => {
    if (!isStatusLifecycleAuthority()) return;
    void processCurrentCombatantStatusEffects(combat);
  });
}

export async function initializeStatusLifecycle(actor, statusId, options = {}) {
  if (!actor || !statusId) return null;
  return enqueueLifecycleUpdate(actor, async () => {
    const lifecycles = cloneData(getStatusLifecycles(actor));
    const existing = lifecycles[statusId];
    const requestedDuration = parseStatusDurationRounds(options.durationRounds);
    if (existing) {
      if (requestedDuration && requestedDuration > (parseStatusDurationRounds(existing.remainingRounds) ?? 0)) {
        existing.remainingRounds = requestedDuration;
        await setStatusLifecycles(actor, lifecycles);
      }
      return existing;
    }

    const lifecycle = buildInitialStatusLifecycle(statusId, options.combat ?? globalThis.game?.combat, {
      durationRounds: requestedDuration,
      appliedAt: options.appliedAt,
    });
    lifecycles[statusId] = lifecycle;
    await setStatusLifecycles(actor, lifecycles);
    return lifecycle;
  });
}

export async function removeStatusLifecycle(actor, statusId) {
  if (!actor || !statusId) return false;
  return enqueueLifecycleUpdate(actor, async () => {
    const lifecycles = cloneData(getStatusLifecycles(actor));
    if (!Object.hasOwn(lifecycles, statusId)) return false;
    delete lifecycles[statusId];
    await setStatusLifecycles(actor, lifecycles);
    return true;
  });
}

export async function processCurrentCombatantStatusEffects(combat) {
  const combatant = getCurrentCombatant(combat);
  const actor = combatant?.actor ?? combatant?.token?.actor;
  if (!actor) return [];

  const statusIds = [...(actor.statuses ?? [])];
  const lifecycles = cloneData(getStatusLifecycles(actor));
  const resolutions = [];
  for (const statusId of statusIds) {
    const rule = DEFAULT_ONGOING_STATUS_RULES[statusId];
    const existing = lifecycles[statusId];
    if (!rule && !parseStatusDurationRounds(existing?.remainingRounds)) continue;

    const lifecycle = existing ?? buildInitialStatusLifecycle(statusId, null);
    const plan = getStatusTurnPlan(statusId, lifecycle, combat);
    if (!plan.process) continue;

    lifecycles[statusId] = {
      ...lifecycle,
      combatId: combat.id,
      lastProcessedTurnKey: plan.turnKey,
      remainingRounds: plan.remainingRounds,
    };
    await setStatusLifecycles(actor, lifecycles);

    if (plan.expireBeforeTick) {
      await expireStatus(actor, statusId);
      resolutions.push({ statusId, expired: true, damage: 0 });
      await createStatusChatMessage(actor, statusId, { expired: true });
      continue;
    }

    let damageResolution = null;
    if (plan.tick) {
      damageResolution = statusId === "fire"
        ? await applyFireStatusDamage(actor, plan.rule.damage)
        : await applyDirectStatusDamage(actor, statusId, plan.rule.damage);
    }

    if (plan.expireAfterTick) await expireStatus(actor, statusId);
    const resolution = {
      statusId,
      expired: plan.expireAfterTick,
      remainingRounds: plan.remainingRounds,
      ...damageResolution,
    };
    resolutions.push(resolution);
    await createStatusChatMessage(actor, statusId, resolution);
  }
  return resolutions;
}

async function applyDirectStatusDamage(actor, statusId, amount) {
  const before = Number(actor.system?.derivedStats?.hp?.value);
  if (!Number.isFinite(before)) return { damage: 0, before: null, after: null };
  const damage = getOngoingStatusDamage(actor, statusId, amount);
  const after = before - damage;
  await actor.update({ "system.derivedStats.hp.value": after }, { witcherOngoingStatus: true });
  return { damage, before, after, ignoresArmor: true };
}

async function applyFireStatusDamage(actor, amount) {
  const locations = buildFireLocationStates(actor, amount);
  const damage = locations.reduce((total, location) => total + location.damage, 0);
  const before = Number(actor.system?.derivedStats?.hp?.value);
  const after = Number.isFinite(before) ? before - damage : null;
  if (Number.isFinite(after)) {
    await actor.update({ "system.derivedStats.hp.value": after }, { witcherOngoingStatus: true });
  }
  const armorAblation = await ablateFireArmor(actor);
  return { damage, before: Number.isFinite(before) ? before : null, after, locations, armorAblation };
}

function buildFireLocationStates(actor, amount) {
  const armors = Array.from(actor?.items ?? []).filter(item => item?.type === "armor" && isArmorEquipped(item));
  const hasEquippedArmor = armors.length > 0;
  const definitions = [
    { key: "head", fields: ["headStopping"], locations: ["Head", "FullCover"], monsterField: "armorHead" },
    { key: "upper", fields: ["torsoStopping"], locations: ["Torso", "FullCover"], monsterField: "armorUpper" },
    { key: "lower", fields: ["rightLegStopping", "leftLegStopping"], locations: ["Leg", "FullCover"], monsterField: "armorLower" },
  ];

  return definitions.map(definition => {
    const protecting = armors.filter(armor => (
      armor.system?.type === "Natural"
      || definition.locations.includes(String(armor.system?.location ?? "").trim())
    ));
    const stoppingPower = actor?.type === "monster" && !hasEquippedArmor
      ? Math.max(0, normalizeSp(actor.system?.[definition.monsterField]))
      : getLocationStoppingPower(protecting, definition.fields);
    const resistant = protecting.some(armor => (
      Boolean(armor.system?.fire)
      || (armor.system?.effects ?? []).some(effect => effect?.statusEffect === "fire")
    ));
    return {
      key: definition.key,
      baseDamage: amount,
      stoppingPower,
      resistant,
      damage: resolveFireLocationDamage(amount, stoppingPower, resistant),
    };
  });
}

function getLocationStoppingPower(armors, fields) {
  const armorByType = { Light: [], Medium: [], Heavy: [] };
  let natural = 0;
  for (const armor of armors) {
    const values = fields.map(field => Math.max(0, normalizeSp(armor.system?.[field])));
    const value = fields.length > 1 ? Math.min(...values) : values[0];
    if (armor.system?.type === "Natural") natural += value;
    else if (armorByType[armor.system?.type]) armorByType[armor.system.type].push(value);
  }
  return natural + calculateStackedArmorSp(
    Math.max(0, ...armorByType.Light),
    Math.max(0, ...armorByType.Medium),
    Math.max(0, ...armorByType.Heavy),
  );
}

async function ablateFireArmor(actor) {
  const equippedArmors = Array.from(actor?.items ?? [])
    .filter(item => item?.type === "armor" && isArmorEquipped(item));
  const itemUpdates = [];
  const changes = [];
  for (const armor of equippedArmors) {
    const fields = getArmorFireFields(armor);
    const update = { _id: armor.id };
    for (const field of fields) {
      const before = Math.max(0, normalizeSp(armor.system?.[field]));
      const after = Math.max(0, before - 1);
      if (after === before) continue;
      update[`system.${field}`] = after;
      changes.push({ name: armor.name, field, before, after });
    }
    if (Object.keys(update).length > 1) itemUpdates.push(update);
  }
  if (itemUpdates.length) {
    await actor.updateEmbeddedDocuments("Item", itemUpdates, { witcherOngoingStatus: true });
  }

  if (actor?.type === "monster" && equippedArmors.length === 0) {
    const updates = {};
    for (const field of ["armorHead", "armorUpper", "armorLower"]) {
      const before = Math.max(0, normalizeSp(actor.system?.[field]));
      const after = Math.max(0, before - 1);
      if (after === before) continue;
      updates[`system.${field}`] = after;
      changes.push({ name: actor.name, field, before, after });
    }
    if (Object.keys(updates).length) await actor.update(updates, { witcherOngoingStatus: true });
  }
  return changes;
}

function getArmorFireFields(armor) {
  if (armor.system?.type === "Natural" || armor.system?.location === "FullCover") {
    return ["headStopping", "torsoStopping", "rightArmStopping", "leftArmStopping", "rightLegStopping", "leftLegStopping"];
  }
  if (armor.system?.location === "Head") return ["headStopping"];
  if (armor.system?.location === "Torso") return ["torsoStopping", "rightArmStopping", "leftArmStopping"];
  if (armor.system?.location === "Leg") return ["rightLegStopping", "leftLegStopping"];
  return [];
}

async function expireStatus(actor, statusId) {
  if (actor?.statuses?.has(statusId) && actor?.toggleStatusEffect) {
    await actor.toggleStatusEffect(statusId, { active: false });
  }
  await removeStatusLifecycle(actor, statusId);
}

async function createStatusChatMessage(actor, statusId, resolution) {
  const ChatMessageClass = globalThis.ChatMessage;
  if (!ChatMessageClass?.create) return null;
  const status = findStatusEffect(globalThis.CONFIG?.WITCHER?.statusEffects, statusId);
  const localize = value => globalThis.game?.i18n?.localize?.(value) ?? value;
  const format = (key, data) => globalThis.game?.i18n?.format?.(key, data) ?? key;
  const label = localize(status?.name ?? status?.label ?? statusId);
  const rows = [];
  if (resolution.damage !== undefined) {
    rows.push(statusRow(localize("WITCHER.StatusLifecycle.Damage"), resolution.damage));
  }
  if (resolution.before !== null && resolution.before !== undefined) {
    rows.push(statusRow(localize("WITCHER.StatusLifecycle.Health"), `${resolution.before} → ${resolution.after}`));
  }
  for (const location of resolution.locations ?? []) {
    rows.push(statusRow(
      localize(`WITCHER.StatusLifecycle.FireLocation.${location.key}`),
      format("WITCHER.StatusLifecycle.FireCalculation", {
        damage: location.baseDamage,
        sp: location.stoppingPower,
        applied: location.damage,
      }),
    ));
  }
  if (resolution.armorAblation?.length) {
    rows.push(statusRow(localize("WITCHER.StatusLifecycle.ArmorAblation"), resolution.armorAblation.length));
  }
  if (resolution.remainingRounds !== null && resolution.remainingRounds !== undefined && !resolution.expired) {
    rows.push(statusRow(localize("WITCHER.StatusLifecycle.Remaining"), resolution.remainingRounds));
  }
  if (resolution.expired) rows.push(statusRow(localize("WITCHER.StatusLifecycle.Expired"), "✓"));

  const content = `
    <section class="damage-resolution-card ${resolution.damage > 0 ? "is-applied" : "is-absorbed"}">
      <header class="damage-resolution-heading">
        <div class="damage-resolution-title">
          <img src="${escapeHtml(status?.img ?? status?.icon ?? "icons/svg/aura.svg")}" class="chat-icon" alt="">
          <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(actor.name ?? "")}</small></span>
        </div>
      </header>
      <div class="damage-resolution-calculation">${rows.join("")}</div>
    </section>`;
  return ChatMessageClass.create({
    speaker: ChatMessageClass.getSpeaker?.({ actor }) ?? {},
    content,
    flags: { [FLAG_SCOPE]: { ongoingStatus: { actorUuid: actor.uuid ?? null, statusId, ...resolution } } },
  });
}

function statusRow(label, value) {
  return `<div class="damage-resolution-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function getStatusLifecycles(actor) {
  return actor?.getFlag?.(FLAG_SCOPE, LIFECYCLE_FLAG)
    ?? actor?.flags?.[FLAG_SCOPE]?.[LIFECYCLE_FLAG]
    ?? {};
}

async function setStatusLifecycles(actor, lifecycles) {
  if (actor?.setFlag) return actor.setFlag(FLAG_SCOPE, LIFECYCLE_FLAG, lifecycles);
  if (actor?.update) return actor.update({ [`flags.${FLAG_SCOPE}.${LIFECYCLE_FLAG}`]: lifecycles });
  return null;
}

function getCurrentCombatant(combat) {
  return combat?.combatant
    ?? combat?.combatants?.get?.(combat?.current?.combatantId)
    ?? combat?.turns?.[normalizeNonNegativeInteger(combat?.turn)]
    ?? null;
}

function combatChangeStartsTurn(changes) {
  return ["turn", "round", "combatantId"].some(key => Object.hasOwn(changes ?? {}, key))
    || Boolean(changes?.current);
}

function isStatusLifecycleAuthority(userId = null) {
  const users = Array.from(globalThis.game?.users ?? []);
  const activeGms = users
    .filter(user => user?.active && user?.isGM)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  if (activeGms.length) return activeGms[0].id === globalThis.game?.user?.id;
  return isOriginatingClient(userId);
}

function isOriginatingClient(userId) {
  const currentUserId = globalThis.game?.user?.id;
  return !userId || !currentUserId || userId === currentUserId;
}

function getNativeStatusEffectIds(effect) {
  const statuses = effect?.statuses ?? effect?._source?.statuses ?? [];
  const legacyStatusId = effect?.getFlag?.("core", "statusId")
    ?? effect?.flags?.core?.statusId
    ?? null;
  return [...new Set([...Array.from(statuses ?? []), legacyStatusId].filter(Boolean))];
}

function findStatusEffect(statusEffects, statusId) {
  const effects = Array.isArray(statusEffects) ? statusEffects : Object.values(statusEffects ?? {});
  return effects.find(effect => effect?.id === statusId);
}

function getConfiguredStatusDurationRounds(statusId) {
  const status = findStatusEffect(globalThis.CONFIG?.WITCHER?.statusEffects, statusId);
  return parseStatusDurationRounds(
    status?.ongoingEffect?.durationRounds ?? status?.systemEffect?.durationRounds,
  );
}

function enqueueLifecycleUpdate(actor, operation) {
  const previous = lifecycleQueues.get(actor) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  lifecycleQueues.set(actor, next);
  return next.finally(() => {
    if (lifecycleQueues.get(actor) === next) lifecycleQueues.delete(actor);
  });
}

function isArmorEquipped(armor) {
  return [true, "true", "checked", 1, "1"].includes(armor.system?.equipped);
}

function getArmorDifferenceBonus(outer, inner) {
  if (outer <= 0 || inner <= 0) return 0;
  const difference = Math.abs(outer - inner);
  if (difference > 20) return 0;
  if (difference > 15) return 2;
  if (difference > 9) return 3;
  if (difference > 5) return 4;
  return 5;
}

function normalizeSp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function cloneData(value) {
  return globalThis.foundry?.utils?.deepClone?.(value)
    ?? JSON.parse(JSON.stringify(value ?? {}));
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
