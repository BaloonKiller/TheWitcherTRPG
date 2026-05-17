const MAX_DEATH_SAVE_PENALTY = 9;

export function normalizeDeathSavePenalty(value) {
  const penalty = Math.floor(Number(value));
  if (!Number.isFinite(penalty)) return 0;
  return Math.clamped
    ? Math.clamped(penalty, 0, MAX_DEATH_SAVE_PENALTY)
    : Math.min(MAX_DEATH_SAVE_PENALTY, Math.max(0, penalty));
}

export function getSaveDetails({ hp, stun, body, will, deathSaves }) {
  const isDeathSave = Number(hp) <= 0;
  const unmodifiedStun = Math.floor((Number(body) + Number(will)) / 2);
  const base = Math.min(10, isDeathSave ? unmodifiedStun : Number(stun));
  const penalty = isDeathSave ? normalizeDeathSavePenalty(deathSaves) : 0;

  return {
    isDeathSave,
    base,
    penalty,
    threshold: Math.max(0, base - penalty),
  };
}

export function normalizeLuckSpend(value, available) {
  const pool = Math.max(0, Math.floor(Number(available)) || 0);
  const spent = Math.max(0, Math.floor(Number(value)) || 0);
  return Math.min(spent, pool);
}

export function resolveDeathSave({ isDeathSave, success, deathSaves }) {
  const penalty = normalizeDeathSavePenalty(deathSaves);
  if (!isDeathSave || success === null) {
    return { deathSaves: 0, deathSaveFailed: false };
  }
  if (!success) {
    return { deathSaves: penalty, deathSaveFailed: true };
  }

  return {
    deathSaves: normalizeDeathSavePenalty(penalty + 1),
    deathSaveFailed: false,
  };
}

export function getUpdatedHpValue(changes) {
  const nestedHp = changes?.system?.derivedStats?.hp?.value;
  const flatHp = changes?.["system.derivedStats.hp.value"];
  const rawHp = nestedHp ?? flatHp;
  if (rawHp === undefined || rawHp === null || rawHp === "") return null;

  const hp = Number(rawHp);
  return Number.isFinite(hp) ? hp : null;
}

export function parseHpInputValue(value) {
  if (typeof value === "string" && value.trim() === "") return null;

  const hp = Number(value);
  return Number.isFinite(hp) ? hp : null;
}

export function resetDeathSavesAfterRecovery(changes) {
  const updatedHp = getUpdatedHpValue(changes);
  if (updatedHp === null || updatedHp <= 0) return false;

  changes["system.deathSaves"] = 0;
  changes["system.deathSaveFailed"] = false;
  return true;
}

export function registerDeathSaveHooks(hooks = globalThis.Hooks, recalculateActor = null) {
  if (!hooks?.on) return;
  hooks.on("preUpdateActor", (_actor, changes, options) => {
    if (options?.witcherHpDerivedRecalculation) return;
    resetDeathSavesAfterRecovery(changes);
  });
  hooks.on("updateActor", (actor, changes, options, userId) => {
    if (options?.witcherHpDerivedRecalculation) return;
    if (getUpdatedHpValue(changes) === null || typeof recalculateActor !== "function") return;

    const currentUserId = globalThis.game?.user?.id;
    if (userId && currentUserId && userId !== currentUserId) return;

    Promise.resolve(recalculateActor(actor, { witcherHpDerivedRecalculation: true })).catch(error => {
      console.error("TheWitcherTRPG | Failed to recalculate actor after an HP update.", error);
    });
  });
}
