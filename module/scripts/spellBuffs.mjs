const FLAG_SCOPE = "thewitchertrpg";
const SHIELD_FLAG = "spellShield";
const SHIELD_EFFECT_FLAG = "spellShieldEffect";

const SHIELD_PROFILES = Object.freeze({
  quen: Object.freeze({
    ids: Object.freeze(["y1ckoIaGIVqwvvkC"]),
    names: Object.freeze(["quen"]),
    formula: "5",
    scalesWithStamina: true,
    durationRounds: 10,
    preventRecastWhileActive: true,
  }),
});

export function getSpellShieldDefinition(spell) {
  if (!spell) return null;

  const profileEntry = Object.entries(SHIELD_PROFILES)
    .find(([, profile]) => matchesSpellProfile(spell, profile));
  const [profileKey, profile] = profileEntry ?? [];
  const configuredFormula = String(spell.system?.shield ?? "").trim();
  const configured = Boolean(spell.system?.createsShield) && Boolean(configuredFormula);
  if (!profile && !configured) return null;

  return {
    key: profileKey ?? getSpellKey(spell),
    spellName: String(spell.name ?? ""),
    spellUuid: spell.uuid ?? null,
    img: spell.img ?? "icons/svg/shield.svg",
    formula: configuredFormula || profile?.formula || "0",
    scalesWithStamina: profile?.scalesWithStamina ?? Boolean(spell.system?.staminaIsVar),
    durationRounds: parseSpellBuffDurationRounds(spell.system?.duration)
      ?? profile?.durationRounds
      ?? null,
    preventRecastWhileActive: profile?.preventRecastWhileActive ?? false,
  };
}

export function parseSpellBuffDurationRounds(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  const normalized = String(value).trim();
  const match = normalized.match(/(?:^|\D)(\d+)\s*(?:rounds?|rnds?|rund(?:a|y|ę)?)(?:\D|$)/i);
  const rounds = Number(match?.[1]);
  return Number.isInteger(rounds) && rounds > 0 ? rounds : null;
}

export function getSpellShieldFormula(definition, staminaSpent = 1) {
  const formula = String(definition?.formula ?? "0").replace(/\/\s*STA\b/gi, "").trim() || "0";
  if (!definition?.scalesWithStamina) return formula;

  const stamina = Math.max(1, Math.floor(Number(staminaSpent) || 1));
  const numeric = Number(formula);
  if (Number.isFinite(numeric)) return String(numeric * stamina);

  const dice = formula.match(/^\s*(\d*)d(\d+)(.*)$/i);
  if (dice) {
    const diceCount = Math.max(1, Number(dice[1]) || 1);
    return `${diceCount * stamina}d${dice[2]}${dice[3] ?? ""}`;
  }
  return `(${formula}) * ${stamina}`;
}

export function getActorSpellShield(actor) {
  return actor?.getFlag?.(FLAG_SCOPE, SHIELD_FLAG)
    ?? actor?.flags?.[FLAG_SCOPE]?.[SHIELD_FLAG]
    ?? null;
}

export function isSpellShieldActive(actor, definition = null) {
  const shield = Math.max(0, Number(actor?.system?.derivedStats?.shield?.value) || 0);
  const lifecycle = getActorSpellShield(actor);
  if (shield <= 0 || !lifecycle) return false;
  return !definition || lifecycle.key === definition.key;
}

export function canApplySpellShieldBuff(actor, definition) {
  if (!definition) return { allowed: false, reason: "not-shield" };
  if (!definition.preventRecastWhileActive) return { allowed: true };
  if (isSpellShieldActive(actor)) {
    return { allowed: false, reason: "active", lifecycle: getActorSpellShield(actor) };
  }
  return { allowed: true };
}

export async function applySpellShieldBuff(actor, spell, options = {}) {
  const definition = options.definition ?? getSpellShieldDefinition(spell);
  const availability = canApplySpellShieldBuff(actor, definition);
  if (!availability.allowed) return { applied: false, ...availability, definition };

  const formula = getSpellShieldFormula(definition, options.staminaSpent);
  const value = await evaluateShieldFormula(formula, options.evaluateFormula);
  if (!Number.isFinite(value) || value <= 0) {
    return { applied: false, reason: "invalid-formula", definition, formula };
  }

  const previous = getActorSpellShield(actor);
  if (previous) await clearSpellShieldBuff(actor, { announce: false });

  const combat = options.combat ?? globalThis.game?.combat ?? null;
  const combatant = getCurrentCombatant(combat);
  const instanceId = createInstanceId();
  let effect = null;
  if (actor?.createEmbeddedDocuments) {
    const created = await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: definition.spellName,
      img: definition.img,
      origin: definition.spellUuid,
      disabled: false,
      transfer: false,
      changes: [],
      duration: buildEffectDuration(definition.durationRounds, combat),
      flags: {
        [FLAG_SCOPE]: {
          [SHIELD_EFFECT_FLAG]: {
            instanceId,
            key: definition.key,
          },
        },
      },
    }], { witcherSpellShieldApply: true });
    effect = created?.[0] ?? null;
  }

  const lifecycle = {
    instanceId,
    key: definition.key,
    spellName: definition.spellName,
    spellUuid: definition.spellUuid,
    img: definition.img,
    value,
    effectId: effect?.id ?? effect?._id ?? null,
    durationRounds: definition.durationRounds,
    remainingRounds: definition.durationRounds,
    combatId: combat?.id ?? null,
    appliedRound: normalizePositiveInteger(combat?.round),
    appliedTurn: normalizeNonNegativeInteger(combat?.turn),
    appliedCombatantId: combatant?.id ?? null,
    lastProcessedTurnKey: null,
    appliedAt: Date.now(),
  };

  try {
    await actor.update({ "system.derivedStats.shield.value": value }, { witcherSpellShieldApply: true });
    await setActorSpellShield(actor, lifecycle);
  } catch (error) {
    if (effect?.delete) await effect.delete({ witcherSpellShieldCleanup: true });
    throw error;
  }

  if (options.announce !== false) await createSpellShieldChatMessage(actor, lifecycle, "applied");
  return { applied: true, value, formula, definition, lifecycle, effect };
}

export async function clearSpellShieldBuff(actor, options = {}) {
  const lifecycle = getActorSpellShield(actor);
  if (!lifecycle) return false;
  if (options.instanceId && lifecycle.instanceId !== options.instanceId) return false;

  await actor.update({ "system.derivedStats.shield.value": 0 }, { witcherSpellShieldCleanup: true });
  await unsetActorSpellShield(actor);

  if (!options.effectDeleting && lifecycle.effectId) {
    const effect = getActorEffect(actor, lifecycle.effectId);
    if (effect?.delete) await effect.delete({ witcherSpellShieldCleanup: true });
  }
  if (options.announce) await createSpellShieldChatMessage(actor, lifecycle, options.reason ?? "expired");
  return true;
}

export function getSpellShieldTurnPlan(lifecycle, combat) {
  const remaining = normalizePositiveInteger(lifecycle?.remainingRounds);
  const turnKey = getCombatTurnKey(combat);
  if (remaining === null || !turnKey || lifecycle?.lastProcessedTurnKey === turnKey) {
    return { process: false, turnKey, remainingRounds: remaining };
  }

  const currentCombatant = getCurrentCombatant(combat);
  const appliedThisTurn = lifecycle?.combatId === combat?.id
    && lifecycle?.appliedRound === normalizePositiveInteger(combat?.round)
    && lifecycle?.appliedTurn === normalizeNonNegativeInteger(combat?.turn)
    && lifecycle?.appliedCombatantId === currentCombatant?.id;
  if (appliedThisTurn) return { process: false, turnKey, remainingRounds: remaining, appliedThisTurn: true };

  const remainingRounds = Math.max(0, remaining - 1);
  return {
    process: true,
    turnKey,
    remainingRounds,
    expired: remainingRounds === 0,
  };
}

export async function processCurrentCombatantSpellBuffs(combat) {
  const combatant = getCurrentCombatant(combat);
  const actor = combatant?.actor ?? combatant?.token?.actor;
  if (!actor) return null;

  const lifecycle = getActorSpellShield(actor);
  if (!lifecycle) return null;
  if (Math.max(0, Number(actor.system?.derivedStats?.shield?.value) || 0) <= 0) {
    await clearSpellShieldBuff(actor, { announce: false });
    return { expired: true, reason: "depleted" };
  }

  const plan = getSpellShieldTurnPlan(lifecycle, combat);
  if (!plan.process) return null;
  if (plan.expired) {
    await clearSpellShieldBuff(actor, { announce: true, reason: "expired" });
    return { expired: true, remainingRounds: 0 };
  }

  const updated = {
    ...lifecycle,
    combatId: combat.id,
    lastProcessedTurnKey: plan.turnKey,
    remainingRounds: plan.remainingRounds,
  };
  await setActorSpellShield(actor, updated);
  return { expired: false, remainingRounds: plan.remainingRounds };
}

export function registerSpellBuffHooks(hooks = globalThis.Hooks) {
  if (!hooks?.on) return;

  hooks.on("updateActor", (actor, changes, options, userId) => {
    if (options?.witcherSpellShieldCleanup
      || options?.witcherSpellShieldApply
      || !isOriginatingClient(userId)) return;
    const shieldValue = getChangedShieldValue(changes);
    if (shieldValue === null || shieldValue > 0 || !getActorSpellShield(actor)) return;
    void clearSpellShieldBuff(actor, { announce: false });
  });
  hooks.on("deleteActiveEffect", (effect, options, userId) => {
    if (options?.witcherSpellShieldCleanup || !isOriginatingClient(userId)) return;
    const effectFlag = getSpellShieldEffectFlag(effect);
    const actor = effect?.parent ?? effect?.actor;
    if (!effectFlag || !actor) return;
    void clearSpellShieldBuff(actor, {
      instanceId: effectFlag.instanceId,
      effectDeleting: true,
      announce: false,
    });
  });
  hooks.on("updateCombat", (combat, changes, _options, userId) => {
    if (!combatChangeStartsTurn(changes) || !isLifecycleAuthority(userId)) return;
    void processCurrentCombatantSpellBuffs(combat);
  });
  hooks.on("combatStart", combat => {
    if (!isLifecycleAuthority()) return;
    void processCurrentCombatantSpellBuffs(combat);
  });
}

async function evaluateShieldFormula(formula, evaluator = null) {
  if (typeof evaluator === "function") {
    return Math.max(0, Math.floor(Number(await evaluator(formula)) || 0));
  }
  const numeric = Number(formula);
  if (Number.isFinite(numeric)) return Math.max(0, Math.floor(numeric));

  const RollClass = globalThis.Roll;
  if (!RollClass) return Number.NaN;
  const roll = await new RollClass(formula).evaluate();
  return Math.max(0, Math.floor(Number(roll.total) || 0));
}

async function createSpellShieldChatMessage(actor, lifecycle, reason) {
  const ChatMessageClass = globalThis.ChatMessage;
  if (!ChatMessageClass?.create) return null;
  const localize = value => globalThis.game?.i18n?.localize?.(value) ?? value;
  const applied = reason === "applied";
  const status = applied
    ? `${escapeHtml(actor.name ?? "")} ${escapeHtml(localize("WITCHER.Combat.shieldApplied"))} <strong>${lifecycle.value}</strong>`
    : `${escapeHtml(localize("WITCHER.StatusLifecycle.Expired"))}: ${escapeHtml(localize("WITCHER.Spell.Short.Shield"))}`;
  const duration = applied && lifecycle.remainingRounds
    ? `<div>${escapeHtml(localize("WITCHER.StatusLifecycle.Remaining"))}: <strong>${lifecycle.remainingRounds}</strong></div>`
    : "";
  return ChatMessageClass.create({
    speaker: ChatMessageClass.getSpeaker?.({ actor }) ?? {},
    content: `<section class="damage-resolution-card is-applied">
      <header class="damage-resolution-heading"><div class="damage-resolution-title">
        <img src="${escapeHtml(lifecycle.img ?? "icons/svg/shield.svg")}" class="chat-icon" alt="">
        <span><strong>${escapeHtml(lifecycle.spellName ?? "")}</strong><small>${status}</small></span>
      </div></header>${duration}</section>`,
    flags: { [FLAG_SCOPE]: { spellShield: { actorUuid: actor.uuid ?? null, reason, ...lifecycle } } },
  });
}

function matchesSpellProfile(spell, profile) {
  const ids = getSpellIds(spell);
  if (profile.ids.some(id => ids.has(id))) return true;
  const name = String(spell.name ?? "").trim().toLocaleLowerCase();
  return profile.names.includes(name);
}

function getSpellIds(spell) {
  const sourceId = String(spell?.getFlag?.("core", "sourceId") ?? spell?.flags?.core?.sourceId ?? "");
  return new Set([spell?.id, spell?._id, sourceId.split(".").at(-1)].filter(Boolean));
}

function getSpellKey(spell) {
  return String(spell?.id ?? spell?._id ?? spell?.name ?? "shield")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "shield";
}

function buildEffectDuration(durationRounds, combat) {
  const duration = { startTime: Number(globalThis.game?.time?.worldTime) || 0 };
  if (!durationRounds) return duration;
  duration.rounds = durationRounds;
  if (normalizePositiveInteger(combat?.round) !== null) duration.startRound = combat.round;
  if (normalizeNonNegativeInteger(combat?.turn) !== null) duration.startTurn = combat.turn;
  return duration;
}

function getChangedShieldValue(changes) {
  const direct = changes?.["system.derivedStats.shield.value"];
  const nested = changes?.system?.derivedStats?.shield?.value;
  const value = direct ?? nested;
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getSpellShieldEffectFlag(effect) {
  return effect?.getFlag?.(FLAG_SCOPE, SHIELD_EFFECT_FLAG)
    ?? effect?.flags?.[FLAG_SCOPE]?.[SHIELD_EFFECT_FLAG]
    ?? null;
}

function getActorEffect(actor, effectId) {
  return actor?.effects?.get?.(effectId)
    ?? Array.from(actor?.effects ?? []).find(effect => (effect?.id ?? effect?._id) === effectId)
    ?? null;
}

async function setActorSpellShield(actor, lifecycle) {
  if (actor?.setFlag) return actor.setFlag(FLAG_SCOPE, SHIELD_FLAG, lifecycle);
  return actor?.update?.({ [`flags.${FLAG_SCOPE}.${SHIELD_FLAG}`]: lifecycle }, { witcherSpellShieldApply: true });
}

async function unsetActorSpellShield(actor) {
  if (actor?.unsetFlag) return actor.unsetFlag(FLAG_SCOPE, SHIELD_FLAG);
  return actor?.update?.({ [`flags.${FLAG_SCOPE}.-=${SHIELD_FLAG}`]: null }, { witcherSpellShieldCleanup: true });
}

function getCurrentCombatant(combat) {
  return combat?.combatant
    ?? combat?.combatants?.get?.(combat?.current?.combatantId)
    ?? combat?.turns?.[normalizeNonNegativeInteger(combat?.turn)]
    ?? null;
}

function getCombatTurnKey(combat) {
  const combatant = getCurrentCombatant(combat);
  const round = normalizePositiveInteger(combat?.round);
  const turn = normalizeNonNegativeInteger(combat?.turn);
  if (!combat?.id || round === null || turn === null || !combatant?.id) return null;
  return `${combat.id}:${round}:${turn}:${combatant.id}`;
}

function combatChangeStartsTurn(changes) {
  return ["turn", "round", "combatantId"].some(key => Object.hasOwn(changes ?? {}, key))
    || Boolean(changes?.current);
}

function isLifecycleAuthority(userId = null) {
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

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function createInstanceId() {
  return globalThis.foundry?.utils?.randomID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
