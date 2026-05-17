import CommonItemData from "./commonItemData.js";
import itemEffect from "./templates/itemEffectData.js";

const fields = foundry.data.fields;

export default class SpellData extends CommonItemData {

  static defineSchema() {

    const commonData = super.defineSchema();
    return {
      // Using destructuring to effectively append our additional data here
      ...commonData,
      class: new fields.StringField({ initial: '' }),
      level: new fields.StringField({ initial: '' }),
      source: new fields.StringField({ initial: '' }),
      domain: new fields.StringField({ initial: '' }),

      stamina: new fields.NumberField({ initial: 0 }),
      staminaIsVar: new fields.BooleanField({ initial: false }),

      effect: new fields.StringField({ initial: '' }),
      range: new fields.StringField({ initial: '' }),
      duration: new fields.StringField({ initial: '' }),
      defence: new fields.StringField({ initial: '' }),

      components: new fields.StringField({ initial: '' }),
      alternateComponents: new fields.StringField({ initial: '' }),
      preparationTime: new fields.StringField({ initial: '' }),
      difficultyCheck: new fields.StringField({ initial: '' }),
      danger: new fields.StringField({ initial: '' }),
      liftRequirement: new fields.StringField({ initial: '' }),
      sideEffect: new fields.StringField({ initial: '' }),

      createTemplate: new fields.BooleanField({ initial: false }),
      templateSize: new fields.StringField({ initial: '' }),
      templateType: new fields.StringField({ initial: '' }),
      visualEffectDuration: new fields.NumberField(),

      causeDamages: new fields.BooleanField({ initial: false }),
      damage: new fields.StringField({ nullable: true, initial: null }),
      damageType: new fields.StringField({ initial: '' }),
      ignoreArmor: new fields.BooleanField({ initial: false }),
      createsShield: new fields.BooleanField({ initial: false }),
      shield: new fields.StringField({ initial: '' }),
      doesHeal: new fields.BooleanField({ initial: false }),
      heal: new fields.StringField({ initial: '' }),

      effects: new fields.ArrayField(new fields.SchemaField(itemEffect())),
    }
  }


  /** @inheritdoc */
  static migrateData(source) {
    const migrated = super.migrateData(source) ?? source;

    if ("dificultyCheck" in migrated) {
      migrated.difficultyCheck = migrated.dificultyCheck;
    }

    migrated.effects?.forEach(effect => effect.percentage = parseInt(effect.percentage))

    if (migrated.causeDamages) {
      if (!("damageType" in migrated) || migrated.damageType == null) {
        migrated.damageType = inferSpellDamageType(migrated);
      }
      if (!("ignoreArmor" in migrated) || migrated.ignoreArmor == null) {
        migrated.ignoreArmor = spellEffectIgnoresArmor(migrated.effect);
      }
    }

    return migrated;
  }
}

function inferSpellDamageType(spell) {
  const source = String(spell?.source ?? "").toLowerCase();
  const effect = String(spell?.effect ?? "").toLowerCase();

  if (/slashing,\s*piercing,\s*or\s*bludgeoning/.test(effect)) return "";
  if (/\bslash(?:ing)?\b|\bblade\b/.test(effect)) return "slashing";
  if (/\bpierc(?:e|ing)\b|\bneedle\b|\bspike\b|\bshard\b/.test(effect)) return "piercing";
  if (/\bbludgeon(?:ing)?\b|\bconcussive\b|\bslam\b|\bcrush\b/.test(effect)) return "bludgeoning";
  if (
    ["air", "earth", "fire", "water", "mixedelements"].includes(source)
    || /\bfire\b|\bflame\b|\bburn(?:ing)?\b|\blightning\b|\belectric\b|\bice\b|\bfrost\b|\bfrozen\b|\bacid\b/.test(effect)
  ) {
    return "elemental";
  }

  return "";
}

function spellEffectIgnoresArmor(effect) {
  return /\b(?:cannot|can't)\s+be\s+blocked\s+by\s+armor\b|\bignores?\s+armor\b|\bbypasses?\s+armor\b/i.test(String(effect ?? ""));
}
