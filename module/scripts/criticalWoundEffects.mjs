import { applySuccessfulDamageStatusEffects } from "./damageEffects.mjs";
import { getCriticalWoundTier, initializeCriticalWoundHealing } from "./criticalWoundHealing.mjs";

const STAT = Object.freeze({
  INT: "WITCHER.Actor.Stat.Int",
  REF: "WITCHER.Actor.Stat.Ref",
  DEX: "WITCHER.Actor.Stat.Dex",
  BODY: "WITCHER.Actor.Stat.Body",
  SPD: "WITCHER.Actor.Stat.Spd",
  WILL: "WITCHER.Actor.Stat.Will",
});

const DERIVED = Object.freeze({
  STUN: "WITCHER.Actor.CoreStat.Stun",
  ENC: "WITCHER.Actor.CoreStat.Enc",
  REC: "WITCHER.Actor.CoreStat.Rec",
  STA: "WITCHER.Actor.DerStat.Sta",
});

const SKILL = Object.freeze({
  AWARENESS: "WITCHER.SkIntAwareness",
  SOCIAL_ETIQUETTE: "WITCHER.SkIntSocialEt",
  DODGE: "WITCHER.SkRefDodge",
  HEX_WEAVING: "WITCHER.SkWillHexLable",
  INTIMIDATION: "WITCHER.SkWillIntim",
  SPELL_CASTING: "WITCHER.SkWillSpellcastLable",
  RITUAL_CRAFTING: "WITCHER.SkWillRitCraftLable",
  ATHLETICS: "WITCHER.SkDexAthletics",
  PHYSIQUE: "WITCHER.SkBodyPhys",
  CHARISMA: "WITCHER.SkEmpCharisma",
  DECEIT: "WITCHER.SkEmpDeceit",
  LEADERSHIP: "WITCHER.SkEmpLeadership",
  PERSUASION: "WITCHER.SkEmpPersuasion",
  SEDUCTION: "WITCHER.SkEmpSeduction",
});

const MAGICAL_SKILLS = Object.freeze([
  SKILL.HEX_WEAVING,
  SKILL.SPELL_CASTING,
  SKILL.RITUAL_CRAFTING,
]);

const VERBAL_COMBAT_SKILLS = Object.freeze([
  SKILL.CHARISMA,
  SKILL.PERSUASION,
  SKILL.SEDUCTION,
  SKILL.LEADERSHIP,
  SKILL.DECEIT,
  SKILL.SOCIAL_ETIQUETTE,
  SKILL.INTIMIDATION,
]);

const EMPATHIC_VERBAL_SKILLS = Object.freeze([
  SKILL.CHARISMA,
  SKILL.PERSUASION,
  SKILL.DECEIT,
  SKILL.SOCIAL_ETIQUETTE,
  SKILL.LEADERSHIP,
]);

const LEG_SKILLS = Object.freeze([SKILL.DODGE, SKILL.ATHLETICS]);

const CRITICAL_WOUND_MECHANICS = Object.freeze({
  SimpleCrackedJaw: stages(
    stage({ skills: skillPenalties("-2", MAGICAL_SKILLS, VERBAL_COMBAT_SKILLS) }),
    stage({ skills: skillPenalties("-1", MAGICAL_SKILLS, VERBAL_COMBAT_SKILLS) }),
    stage({ skills: skillPenalties("-1", MAGICAL_SKILLS) }),
  ),
  SimpleDisfiguringScar: stages(
    stage({ skills: skillPenalties("-3", EMPATHIC_VERBAL_SKILLS) }),
    stage({ skills: skillPenalties("-1", EMPATHIC_VERBAL_SKILLS) }),
    stage({ skills: skillPenalties("-1", [SKILL.SEDUCTION]) }),
  ),
  SimpleCrackedRibs: stages(
    stage({ stats: { [STAT.BODY]: "-2" } }),
    stage({ stats: { [STAT.BODY]: "-1" } }),
    stage({ derived: { [DERIVED.ENC]: "-10" } }),
  ),
  SimpleForeignObject: stages(
    stage({ derived: { [DERIVED.REC]: "/4" } }),
    stage({ derived: { [DERIVED.REC]: "/2" } }),
    stage({ derived: { [DERIVED.REC]: "-2" } }),
  ),
  SimpleSprainedArm: stages(
    stage(),
    stage(),
    stage({ skills: { [SKILL.PHYSIQUE]: "-1" } }),
  ),
  SimpleSprainedLeg: stages(
    stage({ stats: { [STAT.SPD]: "-2" }, skills: skillPenalties("-2", LEG_SKILLS) }),
    stage({ stats: { [STAT.SPD]: "-1" }, skills: skillPenalties("-1", LEG_SKILLS) }),
    stage({ stats: { [STAT.SPD]: "-1" } }),
  ),
  ComplexMinorHeadWound: stages(
    stage({ stats: { [STAT.INT]: "-1", [STAT.WILL]: "-1" }, derived: { [DERIVED.STUN]: "-1" } }),
    stage({ stats: { [STAT.INT]: "-1", [STAT.WILL]: "-1" } }),
    stage({ stats: { [STAT.WILL]: "-1" } }),
  ),
  ComplexLostTeeth: stages(
    stage({ skills: skillPenalties("-3", MAGICAL_SKILLS, VERBAL_COMBAT_SKILLS) }),
    stage({ skills: skillPenalties("-2", MAGICAL_SKILLS, VERBAL_COMBAT_SKILLS) }),
    stage({ skills: skillPenalties("-1", MAGICAL_SKILLS, VERBAL_COMBAT_SKILLS) }),
  ),
  ComplexRupturedSpleen: stages(
    stage({ statuses: ["bleed"] }),
    stage(),
    stage({ derived: { [DERIVED.STUN]: "-2" } }),
  ),
  ComplexBrokenRibs: stages(
    stage({ stats: { [STAT.BODY]: "-2", [STAT.REF]: "-1", [STAT.DEX]: "-1" } }),
    stage({ stats: { [STAT.BODY]: "-1", [STAT.REF]: "-1" } }),
    stage({ stats: { [STAT.BODY]: "-1" } }),
  ),
  ComplexFracturedArm: stages(stage(), stage(), stage()),
  ComplexFracturedLeg: stages(
    stage({ stats: { [STAT.SPD]: "-3" }, skills: skillPenalties("-3", LEG_SKILLS) }),
    stage({ stats: { [STAT.SPD]: "-2" }, skills: skillPenalties("-2", LEG_SKILLS) }),
    stage({ stats: { [STAT.SPD]: "-1" }, skills: skillPenalties("-1", LEG_SKILLS) }),
  ),
  DifficultSkullFracture: stages(
    stage({ stats: { [STAT.INT]: "-1", [STAT.DEX]: "-1" }, statuses: ["bleed"] }),
    stage({ stats: { [STAT.INT]: "-1", [STAT.DEX]: "-1" } }),
    stage(),
  ),
  DifficultConcussion: stages(
    stage({ stats: { [STAT.INT]: "-2", [STAT.REF]: "-2", [STAT.DEX]: "-2" } }),
    stage({ stats: { [STAT.INT]: "-1", [STAT.REF]: "-1", [STAT.DEX]: "-1" } }),
    stage({ stats: { [STAT.INT]: "-1", [STAT.DEX]: "-1" } }),
  ),
  DifficultTornStomach: stages(
    stage({ allSkills: "-2" }),
    stage({ allSkills: "-2" }),
    stage({ allSkills: "-1" }),
  ),
  DifficultSuckingChestWound: stages(
    stage({ stats: { [STAT.BODY]: "-3", [STAT.SPD]: "-3" }, statuses: ["suffocation"] }),
    stage({ stats: { [STAT.BODY]: "-2", [STAT.SPD]: "-2" } }),
    stage({ stats: { [STAT.BODY]: "-1", [STAT.SPD]: "-1" } }),
  ),
  DifficultCompoundArmFracture: stages(
    stage({ statuses: ["bleed"] }),
    stage(),
    stage(),
  ),
  DifficultCompoundLegFracture: stages(
    stage({ stats: { [STAT.SPD]: "/4" }, skills: skillPenalties("/4", LEG_SKILLS), statuses: ["bleed"] }),
    stage({ stats: { [STAT.SPD]: "/2" }, skills: skillPenalties("/2", LEG_SKILLS) }),
    stage({ stats: { [STAT.SPD]: "-2" }, skills: skillPenalties("-2", LEG_SKILLS) }),
  ),
  DeadlyDecapitated: stages(stage(), stage(), stage()),
  DeadlyDamagedEye: stages(
    stage({ stats: { [STAT.DEX]: "-4" }, skills: { [SKILL.AWARENESS]: "-5" }, statuses: ["bleed"] }),
    stage({ stats: { [STAT.DEX]: "-2" }, skills: { [SKILL.AWARENESS]: "-3" } }),
    stage({ stats: { [STAT.DEX]: "-1" }, skills: { [SKILL.AWARENESS]: "-1" } }),
  ),
  DeadlyHearthDamage: stages(
    stage({ stats: { [STAT.BODY]: "/4", [STAT.SPD]: "/4" }, derived: { [DERIVED.STA]: "/4" }, statuses: ["bleed"] }),
    stage({ stats: { [STAT.BODY]: "/2", [STAT.SPD]: "/2" }, derived: { [DERIVED.STA]: "/2" } }),
    stage(),
  ),
  DeadlySepticShock: stages(
    stage({
      stats: { [STAT.INT]: "-3", [STAT.WILL]: "-3", [STAT.REF]: "-3", [STAT.DEX]: "-3" },
      derived: { [DERIVED.STA]: "/4" },
      statuses: ["poison"],
    }),
    stage({
      stats: { [STAT.INT]: "-1", [STAT.WILL]: "-1", [STAT.REF]: "-1", [STAT.DEX]: "-1" },
      derived: { [DERIVED.STA]: "/2" },
    }),
    stage({ derived: { [DERIVED.STA]: "-5" } }),
  ),
  DeadlyDismemberedArm: stages(
    stage({ statuses: ["bleed"] }),
    stage(),
    stage(),
  ),
  DeadlyDismemberedLeg: stages(
    stage({ stats: { [STAT.SPD]: "/4" }, skills: skillPenalties("/4", LEG_SKILLS), statuses: ["bleed"] }),
    stage({ stats: { [STAT.SPD]: "/4" }, skills: skillPenalties("/4", LEG_SKILLS) }),
    stage(),
  ),
});

export function getCriticalWoundMechanics(effect, mod = "None", options = {}) {
  const configured = CRITICAL_WOUND_MECHANICS[effect]?.[mod]
    ?? CRITICAL_WOUND_MECHANICS[effect]?.None
    ?? stage();
  const skills = { ...configured.skills };
  if (configured.allSkills) {
    for (const skillLabel of getAllSkillLabels(options)) {
      skills[skillLabel] = configured.allSkills;
    }
  }

  return {
    stats: modifierEntries(configured.stats, "stat"),
    derived: modifierEntries(configured.derived, "derivedStat"),
    skills: modifierEntries(skills, "skill"),
    statuses: [...configured.statuses],
  };
}

export function getCriticalWoundModifierSources(actor, options = {}) {
  const localize = options.localize ?? getLocalize();

  return getCriticalWounds(actor)
    .filter(wound => wound?.id && wound?.effect)
    .map(wound => {
      const mod = wound.mod || "None";
      const tier = getCriticalWoundTier(wound.effect) ?? "Simple";
      const mechanics = getCriticalWoundMechanics(wound.effect, mod, options);
      return {
        id: wound.id,
        name: `${localize(`WITCHER.CritWound.${tier}`)} - ${localize(`WITCHER.CritWound.Name.${wound.effect}`)}`,
        system: {
          isActive: true,
          stats: mechanics.stats,
          derived: mechanics.derived,
          skills: mechanics.skills,
        },
      };
    });
}

export async function applyCriticalWoundConsequences(actor, wound, options = {}) {
  if (!actor || !wound) return { statuses: [] };

  const mechanics = getCriticalWoundMechanics(wound.effect, wound.mod, options);
  const damage = {
    resolvedEffects: mechanics.statuses.map(statusEffect => ({
      name: statusEffect,
      statusEffect,
      percentage: 100,
      roll: 1,
      success: true,
    })),
  };
  const statuses = mechanics.statuses.length > 0
    ? await applySuccessfulDamageStatusEffects(actor, damage, options.statusEffectOptions)
    : [];
  return { statuses };
}

export async function synchronizeCriticalWoundEffects(actor, options = {}) {
  if (!actor) return { removedEffectIds: [], statuses: [] };

  const body = actor.system?.stats?.body?.max ?? actor.system?.stats?.body?.current;
  const initialized = initializeCriticalWoundHealing(actor.system?.critWounds, body);
  let wounds = initialized.wounds;
  if (initialized.changed && actor.update) {
    await actor.update(
      { "system.critWounds": wounds },
      { thewitchertrpg: { skipCriticalEffectSync: true } },
    );
  }

  const statuses = [];
  for (const wound of wounds) {
    const applied = await applyCriticalWoundConsequences(actor, wound, options);
    statuses.push(...applied.statuses);
  }

  const legacyItems = Array.from(actor.items ?? []).filter(isLegacyCriticalWoundEffect);
  const removedEffectIds = [];
  for (const item of legacyItems) {
    removedEffectIds.push(item.id ?? item._id);
    await item.delete?.();
  }
  const needsRecalculation = options.forceRecalculation
    || initialized.changed
    || wounds.length > 0
    || legacyItems.length > 0;
  if (needsRecalculation && typeof options.recalculateActor === "function") {
    await options.recalculateActor(actor, { thewitchertrpg: { skipCriticalEffectSync: true } });
  }
  return { removedEffectIds, statuses };
}

export function registerCriticalWoundEffectSyncHooks(hooks = globalThis.Hooks, recalculateActor = null) {
  if (!hooks?.on) return;

  hooks.once?.("ready", () => {
    if (!isPrimaryGameMaster()) return;
    const actors = Array.from(globalThis.game?.actors ?? []);
    Promise.all(actors.map(actor => synchronizeCriticalWoundEffects(actor, { recalculateActor })))
      .catch(logSyncError);
  });
  hooks.on("updateActor", (actor, changes, options, userId) => {
    if (!isOriginatingClient(userId)
      || options?.thewitchertrpg?.skipCriticalEffectSync
      || !hasCriticalWoundChanges(changes)) return;
    synchronizeCriticalWoundEffects(actor, {
      recalculateActor,
      forceRecalculation: true,
    }).catch(logSyncError);
  });
}

function stages(None, Stabilized, Treated) {
  return Object.freeze({ None, Stabilized, Treated });
}

function stage({ stats = {}, derived = {}, skills = {}, statuses = [], allSkills = null } = {}) {
  return Object.freeze({ stats, derived, skills, statuses, allSkills });
}

function skillPenalties(modifier, ...groups) {
  return Object.fromEntries(groups.flat().map(skill => [skill, modifier]));
}

function modifierEntries(modifiers, field) {
  return Object.entries(modifiers ?? {}).map(([key, modifier]) => ({
    [field]: key,
    modifier: String(modifier),
  }));
}

function getAllSkillLabels(options) {
  if (Array.isArray(options.skillLabels)) return options.skillLabels;
  return [...new Set(Object.values(globalThis.CONFIG?.WITCHER?.skillMap ?? {})
    .map(skill => skill?.label)
    .filter(Boolean))];
}

function getCriticalWounds(actor) {
  return Object.values(actor.system?.critWounds ?? {}).map(wound => (
    typeof wound?.toObject === "function" ? wound.toObject() : { ...wound }
  ));
}

function isLegacyCriticalWoundEffect(item) {
  const flags = item?.flags?.thewitchertrpg ?? {};
  return item?.type === "effect"
    && Boolean(flags.appliedByCriticalWound || flags.criticalWoundId);
}

function hasCriticalWoundChanges(changes) {
  if (!changes || typeof changes !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(changes, "system.critWounds")) return true;
  if (changes.system && Object.prototype.hasOwnProperty.call(changes.system, "critWounds")) return true;
  return Object.keys(changes).some(key => key.startsWith("system.critWounds."));
}

function isOriginatingClient(userId) {
  const currentUserId = globalThis.game?.user?.id;
  return !userId || !currentUserId || userId === currentUserId;
}

function isPrimaryGameMaster() {
  const currentUser = globalThis.game?.user;
  if (!currentUser?.isGM) return false;
  const activeGameMaster = globalThis.game?.users?.activeGM;
  return !activeGameMaster || activeGameMaster.id === currentUser.id;
}

function getLocalize() {
  return value => globalThis.game?.i18n?.localize?.(value) ?? value;
}

function logSyncError(error) {
  console.error("TheWitcherTRPG | Could not synchronize a critical wound effect.", error);
}
