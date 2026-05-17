const HEALING_TIME_BY_TIER = Object.freeze({
  Simple: Object.freeze({ base: 8, minimum: 1 }),
  Complex: Object.freeze({ base: 12, minimum: 1 }),
  Difficult: Object.freeze({ base: 15, minimum: 2 }),
});

const CRITICAL_WOUND_TIERS = Object.freeze(["Simple", "Complex", "Difficult", "Deadly"]);

export function getCriticalWoundTier(effect) {
  return CRITICAL_WOUND_TIERS
    .find(tier => String(effect ?? "").startsWith(tier))
    ?? null;
}

export function getCriticalWoundHealingTime(effect, body) {
  const tier = getCriticalWoundTier(effect);
  const healing = HEALING_TIME_BY_TIER[tier];
  const numericBody = Math.floor(Number(body));
  if (!healing || !Number.isFinite(numericBody)) return 0;

  const tableBody = Math.min(13, Math.max(3, numericBody));
  return Math.max(healing.minimum, healing.base - tableBody);
}

export function initializeCriticalWoundHealing(wounds, body) {
  const initialized = [];
  let changed = false;

  for (const source of normalizeWounds(wounds)) {
    const wound = { ...source };
    const tier = getCriticalWoundTier(wound.effect);
    if (tier === "Deadly" && (normalizeDays(wound.daysHealed) > 0 || normalizeDays(wound.healingTime) > 0)) {
      wound.daysHealed = 0;
      wound.healingTime = 0;
      changed = true;
    } else if (wound.mod === "Treated" && normalizeDays(wound.healingTime) === 0) {
      const healingTime = getCriticalWoundHealingTime(wound.effect, body);
      if (healingTime > 0) {
        wound.daysHealed = 0;
        wound.healingTime = healingTime;
        changed = true;
      }
    }
    initialized.push(wound);
  }

  return { wounds: initialized, changed };
}

export function advanceCriticalWoundHealing(wounds, body) {
  const initialized = initializeCriticalWoundHealing(wounds, body).wounds;
  const remaining = [];
  const healed = [];

  for (const source of initialized) {
    const wound = { ...source };
    const healingTime = normalizeDays(wound.healingTime);
    if (wound.mod !== "Treated" || healingTime === 0) {
      remaining.push(wound);
      continue;
    }

    if (normalizeDays(wound.daysHealed) >= healingTime) {
      healed.push(wound);
      continue;
    }

    wound.daysHealed = normalizeDays(wound.daysHealed) + 1;
    if (wound.daysHealed >= healingTime) {
      healed.push(wound);
    } else {
      remaining.push(wound);
    }
  }

  return { wounds: remaining, healed };
}

function normalizeWounds(wounds) {
  return Object.values(wounds ?? {}).map(wound => (
    typeof wound?.toObject === "function" ? wound.toObject() : { ...wound }
  ));
}

function normalizeDays(value) {
  const days = Math.floor(Number(value));
  return Number.isFinite(days) ? Math.max(0, days) : 0;
}
