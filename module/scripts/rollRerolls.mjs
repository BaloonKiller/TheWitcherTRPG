const LOCKED_RESOLUTION_STATES = new Set(["preparing", "rolling", "rolled", "applied", "superseded"]);
const LOCKED_AREA_TARGET_STATES = new Set(["rolling", "rolled", "applied"]);
const RUNTIME_RESULT_FLAG_KEYS = new Set([
  "blockWear",
  "damageResolution",
  "defenceResolution",
  "rollReroll",
  "verbalCombatResolution",
]);

const SERIALIZED_CONFIG_FIELDS = [
  "defence",
  "opposedDefence",
  "threshold",
  "showCrit",
  "showSuccess",
  "reversal",
  "tiesSucceed",
  "thresholdDesc",
  "messageOnSuccess",
  "messageOnFailure",
  "flagsOnSuccess",
  "flagsOnFailure",
  "hitLocation",
  "sourceAttackMessageId",
  "targetActorUuid",
  "targetTokenUuid",
];

export function createRollRerollFlag({ formula, baseFlavor, config, success = null } = {}) {
  if (!config?.showResult || config.rerollable === false) return null;
  const kind = config.rerollData?.kind
    ?? (config.defence ? "defence" : (success !== null && !config.onResolved ? "test" : null));
  if (!kind) return null;

  const chain = config.rerollChain ?? {};
  return {
    version: 1,
    state: "available",
    kind,
    formula: String(formula ?? ""),
    baseFlavor: String(baseFlavor ?? ""),
    config: serializeRollConfig(config),
    data: cloneData(config.rerollData ?? {}),
    rootMessageId: chain.rootMessageId ?? null,
    previousMessageId: chain.previousMessageId ?? null,
    count: Math.max(0, Math.floor(Number(chain.count) || 0)),
  };
}

export function getRollRerollAvailability({
  reroll,
  damageState = null,
  verbalState = null,
  areaTargetState = null,
  hasDamageRoll = false,
  hasAppliedConsequence = false,
  canUpdate = true,
} = {}) {
  if (!reroll || reroll.state === "superseded") return { allowed: false, reason: "superseded" };
  if (!canUpdate) return { allowed: false, reason: "permission" };
  if (hasAppliedConsequence
    || hasDamageRoll
    || LOCKED_RESOLUTION_STATES.has(damageState)
    || LOCKED_RESOLUTION_STATES.has(verbalState)
    || LOCKED_AREA_TARGET_STATES.has(areaTargetState)) {
    return { allowed: false, reason: "locked" };
  }
  return { allowed: true, reason: null };
}

export function getNextRerollChain(reroll, messageId) {
  return {
    rootMessageId: reroll?.rootMessageId ?? messageId ?? null,
    previousMessageId: messageId ?? null,
    count: Math.max(0, Math.floor(Number(reroll?.count) || 0)) + 1,
  };
}

export function applySerializedRollConfig(config, serialized = {}) {
  for (const field of SERIALIZED_CONFIG_FIELDS) {
    if (field in serialized) config[field] = cloneConfigField(field, serialized[field]);
  }
  return config;
}

function serializeRollConfig(config) {
  return Object.fromEntries(SERIALIZED_CONFIG_FIELDS
    .filter(field => field in (config ?? {}))
    .map(field => [field, cloneConfigField(field, config[field])]));
}

function cloneConfigField(field, value) {
  const cloned = cloneData(value);
  if (!["flagsOnSuccess", "flagsOnFailure"].includes(field)
    || !cloned
    || typeof cloned !== "object"
    || Array.isArray(cloned)) {
    return cloned;
  }

  const systemFlags = cloned.thewitchertrpg;
  if (!systemFlags || typeof systemFlags !== "object" || Array.isArray(systemFlags)) return cloned;
  for (const key of RUNTIME_RESULT_FLAG_KEYS) delete systemFlags[key];
  if (!Object.keys(systemFlags).length) delete cloned.thewitchertrpg;
  return cloned;
}

function cloneData(value) {
  if (value === undefined) return undefined;
  return globalThis.foundry?.utils?.deepClone?.(value)
    ?? JSON.parse(JSON.stringify(value));
}
