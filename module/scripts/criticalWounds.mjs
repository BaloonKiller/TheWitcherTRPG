const CRITICAL_WOUND_TIERS = Object.freeze([
  Object.freeze({
    key: "Deadly",
    minimumMargin: 15,
    bonusDamage: 10,
    tableId: "GoXapMH54rEUWaZn",
    tableName: "Deadly Critical",
  }),
  Object.freeze({
    key: "Difficult",
    minimumMargin: 13,
    bonusDamage: 8,
    tableId: "VIup1SZTMKCSGGbT",
    tableName: "Difficult Critical",
  }),
  Object.freeze({
    key: "Complex",
    minimumMargin: 10,
    bonusDamage: 5,
    tableId: "p3EAPCnu8RDawpWR",
    tableName: "Complex Critical",
  }),
  Object.freeze({
    key: "Simple",
    minimumMargin: 7,
    bonusDamage: 3,
    tableId: "SkHR3GrB2e3Tz1v4",
    tableName: "Simple Critical",
  }),
]);

const CRITICAL_WOUND_EFFECTS = Object.freeze({
  Simple: Object.freeze({
    2: "SimpleSprainedLeg",
    4: "SimpleSprainedArm",
    6: "SimpleForeignObject",
    9: "SimpleCrackedRibs",
    11: "SimpleDisfiguringScar",
    12: "SimpleCrackedJaw",
  }),
  Complex: Object.freeze({
    2: "ComplexFracturedLeg",
    4: "ComplexFracturedArm",
    6: "ComplexBrokenRibs",
    9: "ComplexRupturedSpleen",
    11: "ComplexLostTeeth",
    12: "ComplexMinorHeadWound",
  }),
  Difficult: Object.freeze({
    2: "DifficultCompoundLegFracture",
    4: "DifficultCompoundArmFracture",
    6: "DifficultSuckingChestWound",
    9: "DifficultTornStomach",
    11: "DifficultConcussion",
    12: "DifficultSkullFracture",
  }),
  Deadly: Object.freeze({
    2: "DeadlyDismemberedLeg",
    4: "DeadlyDismemberedArm",
    6: "DeadlySepticShock",
    9: "DeadlyHearthDamage",
    11: "DeadlyDamagedEye",
    12: "DeadlyDecapitated",
  }),
});

export function getCriticalWound(margin) {
  const numericMargin = Number(margin);
  if (!Number.isFinite(numericMargin)) {
    return null;
  }

  return CRITICAL_WOUND_TIERS.find(tier => numericMargin >= tier.minimumMargin) ?? null;
}

export function getCriticalWoundBonusDamage(damage, actor) {
  const resolution = damage?.defenceResolution;
  if (!resolution || !matchesTargetActor(resolution, actor)) return 0;

  const bonusDamage = Number(resolution.bonusDamage);
  return Number.isFinite(bonusDamage) ? Math.max(0, bonusDamage) : 0;
}

export function getCriticalWoundLocation(location) {
  const normalizedLocation = String(location ?? "").trim().toLowerCase();
  if (normalizedLocation === "head") return "Head";
  if (normalizedLocation === "torso") return "Torso";
  if (normalizedLocation.endsWith("arm")) return "Arm";
  if (normalizedLocation.endsWith("leg")) return "Leg";
  return null;
}

export function getCriticalWoundResultTarget(location, locationRollTotal = 1) {
  const criticalLocation = getCriticalWoundLocation(location);
  const useGreaterWound = Number(locationRollTotal) >= 5;

  switch (criticalLocation) {
    case "Leg": return 2;
    case "Arm": return 4;
    case "Torso": return useGreaterWound ? 9 : 6;
    case "Head": return useGreaterWound ? 12 : 11;
    default: return null;
  }
}

export function getCriticalWoundTableTarget(rollTotal) {
  const total = Number(rollTotal);
  if (!Number.isFinite(total) || total < 2 || total > 12) return null;
  if (total <= 3) return 2;
  if (total <= 5) return 4;
  if (total <= 8) return 6;
  if (total <= 10) return 9;
  return total;
}

export function getCriticalWoundEffect(criticalWound, target) {
  const tier = typeof criticalWound === "string" ? criticalWound : criticalWound?.key;
  const numericTarget = Number(target);
  const effect = CRITICAL_WOUND_EFFECTS[tier]?.[numericTarget] ?? null;
  return effect ? { tier, target: numericTarget, effect } : null;
}

export async function drawCriticalWound(criticalWound, hitLocation, { displayChat = true } = {}) {
  if (!criticalWound) {
    return null;
  }

  try {
    const table = await findCriticalWoundTable(criticalWound);
    if (!table) {
      notifyMissingTable(criticalWound.tableName);
      return null;
    }

    const criticalLocation = getCriticalWoundLocation(hitLocation);
    if (!criticalLocation) {
      const draw = await table.draw({ displayChat });
      const target = getCriticalWoundTableTarget(draw?.roll?.total);
      return attachCriticalResult(draw, getCriticalWoundEffect(criticalWound, target));
    }

    const locationRoll = ["Head", "Torso"].includes(criticalLocation)
      ? await new Roll("1d6").evaluate()
      : null;
    const target = getCriticalWoundResultTarget(criticalLocation, locationRoll?.total);
    const result = table.results.find(tableResult => (
      tableResult.range[0] <= target && tableResult.range[1] >= target
    ));

    if (!result) {
      console.warn("TheWitcherTRPG | Critical wound result for location was not found.", {
        criticalWound,
        hitLocation,
        target,
      });
      const draw = await table.draw({ displayChat });
      const rolledTarget = getCriticalWoundTableTarget(draw?.roll?.total);
      return attachCriticalResult(draw, getCriticalWoundEffect(criticalWound, rolledTarget));
    }

    const draw = await table.draw({
      roll: locationRoll,
      results: [result],
      displayChat,
    });
    return attachCriticalResult(draw, getCriticalWoundEffect(criticalWound, target));
  } catch (error) {
    console.error("TheWitcherTRPG | Failed to draw a critical wound.", {
      criticalWound,
      error,
    });
    notifyMissingTable(criticalWound.tableName);
    return null;
  }
}

export function buildCriticalWoundRecord(damage, actor, idFactory = createId) {
  const resolution = damage?.defenceResolution;
  const criticalResult = resolution?.criticalResult;
  if (!criticalResult?.effect || !matchesTargetActor(resolution, actor)) return null;

  return {
    id: idFactory(),
    effect: criticalResult.effect,
    mod: "None",
    notes: "",
    daysHealed: 0,
    healingTime: 0,
  };
}

export async function applyDamageCriticalWound(actor, damage, idFactory = createId) {
  if (!actor?.update) return null;

  const wound = buildCriticalWoundRecord(damage, actor, idFactory);
  if (!wound) return null;

  const currentWounds = Object.values(actor.system?.critWounds ?? {}).map(entry => (
    typeof entry?.toObject === "function" ? entry.toObject() : { ...entry }
  ));
  await actor.update({ "system.critWounds": [...currentWounds, wound] });
  return wound;
}

async function findCriticalWoundTable(criticalWound) {
  const combatPack = game.packs?.get("thewitchertrpg.combat")
    ?? game.packs?.find(pack => pack.metadata?.name === "combat" && pack.documentName === "RollTable");
  const compendiumTable = await combatPack?.getDocument(criticalWound.tableId);

  return compendiumTable
    ?? game.tables?.getName?.(criticalWound.tableName)
    ?? game.tables?.find(table => table.name === criticalWound.tableName)
    ?? null;
}

function notifyMissingTable(tableName) {
  const message = game.i18n.format("WITCHER.Chat.CriticalTableMissing", { table: tableName });
  ui.notifications.warn(message);
}

function attachCriticalResult(draw, criticalResult) {
  return { ...(draw ?? {}), criticalResult };
}

function matchesTargetActor(resolution, actor) {
  const targetActorUuid = resolution?.targetActorUuid;
  if (!targetActorUuid) return true;
  return [actor?.uuid, actor?.id, actor?.baseActor?.uuid].filter(Boolean).includes(targetActorUuid);
}

function createId() {
  return globalThis.foundry?.utils?.randomID?.(16)
    ?? globalThis.randomID?.(16)
    ?? Math.random().toString(36).slice(2, 18);
}
