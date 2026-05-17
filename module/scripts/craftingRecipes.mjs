function getRecipeSystem(recipe) {
  return recipe?.system ?? recipe ?? {};
}

export function getPhysicalRecipeQuantity(recipe) {
  const quantity = Number(getRecipeSystem(recipe).quantity);
  return Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0;
}

export function hasPhysicalRecipe(recipe) {
  const system = getRecipeSystem(recipe);
  return getPhysicalRecipeQuantity(system) > 0 && !system.isStored;
}

export function canCraftFromRecipe(recipe) {
  const system = getRecipeSystem(recipe);
  return Boolean(system.learned) || hasPhysicalRecipe(system);
}

export function getRecipeOutputQuantity(recipe) {
  return getPositiveInteger(getRecipeSystem(recipe).outputQuantity, 1);
}

export function getRecipeMemoryCapacity(actorSystem) {
  const intelligence = Number(actorSystem?.stats?.int?.current);
  const bonus = Number(actorSystem?.recipeMemoryBonus);
  const baseCapacity = Number.isFinite(intelligence) ? Math.max(0, Math.floor(intelligence)) : 0;
  const bonusCapacity = Number.isFinite(bonus) ? Math.max(0, Math.floor(bonus)) : 0;
  return baseCapacity + bonusCapacity;
}

export function getRecipeMemoryKey(recipe) {
  const system = getRecipeSystem(recipe);
  const associatedItemUuid = String(system.associatedItemUuid ?? "").trim();
  if (associatedItemUuid) return associatedItemUuid;

  const name = String(recipe?.name ?? "").trim().toLowerCase();
  return `${Boolean(system.isFormulae)}:${String(system.type ?? "")}:${name}`;
}

export function getMemorizedRecipeCount(items) {
  const recipes = Array.from(items ?? []).filter(item => item?.type === "diagrams" && item.system?.learned);
  return new Set(recipes.map(getRecipeMemoryKey)).size;
}

function getPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
