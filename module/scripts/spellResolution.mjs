const DEFENCE_ACTIONS = [
  ["MagicResist", /\bresist\s+magic\b/i],
  ["SpellCasting", /\bspell\s+casting\b/i],
  ["Reposition", /\breposition\b/i],
  ["Dodge", /\bdodge\b/i],
  ["Block", /\bblock\b/i],
];

const SPELL_DEFENCE_OVERRIDES = new Map([
  ["curse of sedna", "Reposition"],
  ["flaming vortex", "Dodge/Escape only"],
  ["hand of the tempest", "Reposition"],
  ["ice slick", "Reposition"],
  ["lightning storm", "Dodge/Escape only"],
  ["merigold's hailstorm", "Dodge/Escape only"],
  ["seirff haul", "Dodge/Escape only"],
  ["talfryn's prison", "Dodge/Escape only"],
  ["wrath of nature", "Dodge, Reposition, Block, or Resist Magic"],
]);

const SPELL_DEFENCE_OVERRIDE_IDS = new Map([
  ["73HgxNWnEt0K7cSx", "Dodge/Escape only"],
  ["8VH8ZV4eycHuP58A", "Dodge/Escape only"],
  ["H674gvzBV1Au394B", "Dodge/Escape only"],
  ["jYZZdmtNsGohaLlw", "Dodge/Escape only"],
  ["jwH48vEXIVhn1YCj", "Reposition"],
  ["pH5Gzfl8j7nh5REj", "Dodge/Escape only"],
  ["pHTDR9XUHEncffWs", "Reposition"],
  ["wZwVF11FOgQyRUDs", "Dodge, Reposition, Block, or Resist Magic"],
  ["ymbf34SUuCGmivkQ", "Reposition"],
]);

export function getEffectiveSpellDefence(spell) {
  const configuredDefence = String(spell?.system?.defence ?? "").trim();
  const spellName = String(spell?.name ?? "").trim().toLocaleLowerCase();
  const sourceId = String(
    spell?.getFlag?.("core", "sourceId")
    ?? spell?.flags?.core?.sourceId
    ?? "",
  );
  const sourceDocumentId = sourceId.split(".").at(-1);
  return SPELL_DEFENCE_OVERRIDE_IDS.get(spell?.id)
    ?? SPELL_DEFENCE_OVERRIDE_IDS.get(spell?._id)
    ?? SPELL_DEFENCE_OVERRIDE_IDS.get(sourceDocumentId)
    ?? SPELL_DEFENCE_OVERRIDES.get(spellName)
    ?? configuredDefence;
}

export function getSpellDefenceActions(defence) {
  const value = String(defence ?? "").trim();
  if (!value || /^(?:none|variable|dc\b)/i.test(value)) return [];

  const actions = new Set(DEFENCE_ACTIONS
    .filter(([, pattern]) => pattern.test(value))
    .map(([action]) => action));
  const dodgeAllowsAthletics = /\bdodge\b/i.test(value)
    && !/\bdodge(?:\s*\/\s*escape)?\s+only\b/i.test(value);
  if (dodgeAllowsAthletics) actions.add("Reposition");
  return DEFENCE_ACTIONS
    .map(([action]) => action)
    .filter(action => actions.has(action));
}

export function hasSpellDefenceRoll(defence) {
  return getSpellDefenceActions(defence).length > 0;
}

export function shouldResolveAttackCriticalWound({ isSpell = false, hasDamage = false } = {}) {
  return !isSpell || Boolean(hasDamage);
}

export function getSpellDamageFormulaDisplay(baseFormula, resolvedFormula, {
  isVariable = false,
  staminaSpent = 1,
} = {}) {
  const source = String(baseFormula ?? resolvedFormula ?? "").trim();
  const total = String(resolvedFormula ?? source).trim();
  const stamina = Math.max(1, Math.floor(Number(staminaSpent) || 1));
  const scalesWithStamina = Boolean(isVariable && /\/\s*sta\b/i.test(source));
  return {
    total,
    base: source.replace(/\/\s*sta\b/gi, "").trim(),
    stamina,
    scalesWithStamina,
  };
}

export function restrictDefenceButtons(buttons, defence) {
  const allowedActions = getSpellDefenceActions(defence);
  if (!String(defence ?? "").trim()) return buttons;

  return Object.fromEntries(
    allowedActions
      .filter(action => buttons[action])
      .map(action => [action, buttons[action]]),
  );
}
