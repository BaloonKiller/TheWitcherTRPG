export function buildVerbalDamageResourceUpdate(currentResolve, totalDamage) {
  const resolve = Number(currentResolve);
  const damage = Number(totalDamage);
  if (!Number.isFinite(resolve) || !Number.isFinite(damage)) return null;

  const resolveBefore = Math.max(0, resolve);
  const rolledDamage = Math.max(0, damage);
  const appliedDamage = Math.min(resolveBefore, rolledDamage);
  const remainingResolve = Math.max(0, resolveBefore - appliedDamage);

  return {
    resolveBefore,
    rolledDamage,
    appliedDamage,
    remainingResolve,
    defeated: remainingResolve === 0,
    updates: {
      "system.derivedStats.resolve.value": remainingResolve,
    },
  };
}

export async function normalizeNegativeResolveValues(actors = globalThis.game?.actors) {
  const currentUser = globalThis.game?.user;
  const activeGameMaster = globalThis.game?.users?.activeGM;
  if (!currentUser?.isGM || (activeGameMaster && activeGameMaster.id !== currentUser.id)) return 0;

  let updatedActors = 0;
  for (const actor of actors ?? []) {
    const storedResolve = Number(
      actor?._source?.system?.derivedStats?.resolve?.value
      ?? actor?.system?.derivedStats?.resolve?.value,
    );
    if (!Number.isFinite(storedResolve) || storedResolve >= 0 || !actor?.update) continue;

    await actor.update({ "system.derivedStats.resolve.value": 0 });
    updatedActors += 1;
  }
  return updatedActors;
}
