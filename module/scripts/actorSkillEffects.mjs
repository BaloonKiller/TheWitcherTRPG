import { getCriticalWoundModifierSources } from "./criticalWoundEffects.mjs";

export function getActorSkillEffectModifiers(actor, skill, options = {}) {
  if (!actor || !skill) return [];
  const localize = options.localize ?? (value => globalThis.game?.i18n?.localize?.(value) ?? value);
  const skillKey = typeof skill === "string" ? skill : (skill.label ?? skill.skill ?? skill.name);
  const localizedSkill = localize(skillKey);

  return getActorModifierSources(actor).flatMap(source => (
    Array.from(source.system?.skills ?? [])
      .filter(effectSkill => (
        effectSkill?.skill === skillKey
        || localize(effectSkill?.skill) === localizedSkill
      ))
      .map(effectSkill => ({
        modifier: String(effectSkill.modifier ?? ""),
        source: source.name ?? source.label ?? "Effect",
        skill: effectSkill.skill,
      }))
  ));
}

export function addActorSkillEffectModifiers(actor, skill, formula, options = {}) {
  const displayRollDetails = options.displayRollDetails
    ?? globalThis.game?.settings?.get?.("thewitchertrpg", "displayRollsDetails")
    ?? false;
  for (const effect of getActorSkillEffectModifiers(actor, skill, options)) {
    const modifier = effect.modifier.trim();
    if (/^\/\s*\d+(?:\.\d+)?$/.test(modifier)) {
      formula += displayRollDetails ? `${modifier}[${effect.source}]` : modifier;
      continue;
    }

    const value = Number(modifier);
    if (!Number.isFinite(value) || value === 0) continue;
    const signedValue = value > 0 ? `+${value}` : String(value);
    formula += displayRollDetails ? `${signedValue}[${effect.source}]` : signedValue;
  }
  return formula;
}

export function isActorEffectItemActive(actor, effect) {
  if (!effect?.system?.isActive) return false;
  const statusId = effect.getFlag?.("thewitchertrpg", "statusEffectId")
    ?? effect.flags?.thewitchertrpg?.statusEffectId
    ?? null;
  if (!statusId || typeof actor?.statuses?.has !== "function") return true;
  return actor.statuses.has(statusId);
}

function getActorModifierSources(actor) {
  const effectItems = actor.getList?.("effect")
    ?? Array.from(actor.items ?? []).filter(item => item.type === "effect");
  return [
    ...effectItems.filter(effect => isActorEffectItemActive(actor, effect)),
    ...getCriticalWoundModifierSources(actor),
  ];
}
