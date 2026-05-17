export function buildDamageResourceUpdate(derivedStat, currentValue, normalDamage, criticalBonusDamage) {
  if (!["hp", "sta"].includes(derivedStat)) return null;

  const resource = derivedStat;
  const current = Number(currentValue);
  const normal = Number(normalDamage);
  const criticalBonus = Number(criticalBonusDamage);

  if (![current, normal, criticalBonus].every(Number.isFinite)) return null;

  const appliedDamage = Math.max(0, normal) + Math.max(0, criticalBonus);
  return {
    appliedDamage,
    resource,
    remaining: current - appliedDamage,
    updates: {
      [`system.derivedStats.${resource}.value`]: current - appliedDamage,
    },
  };
}

export function shouldApplyCriticalWound(derivedStat, criticalBonusDamage) {
  const bonusDamage = Number(criticalBonusDamage);
  return derivedStat === "hp" && Number.isFinite(bonusDamage) && bonusDamage > 0;
}

export function shouldApplyDamageEffects(derivedStat, normalDamage, damage) {
  const appliedDamage = Number(normalDamage);
  return derivedStat === "hp"
    && ((Number.isFinite(appliedDamage) && appliedDamage > 0) || damage?.applyEffectsOnHit === true);
}
