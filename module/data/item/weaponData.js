import CommonItemData from "./commonItemData.js";
import itemEffect from "./templates/itemEffectData.js";
import weaponType from "./templates/weaponTypeData.js";

const fields = foundry.data.fields;

export default class WeaponData extends CommonItemData {

  static defineSchema() {

    const commonData = super.defineSchema();
    return {
      // Using destructuring to effectively append our additional data here
      ...commonData,
      type: new fields.SchemaField(weaponType()),
      isAmmo: new fields.BooleanField({ initial: false }),

      conceal: new fields.StringField({ initial: '' }),
      avail: new fields.StringField({ initial: '' }),
      hands: new fields.NumberField({ initial: 0 }),
      equipped: new fields.BooleanField({ initial: false }),

      reliable: new fields.NumberField({ initial: 0 }),
      maxReliability: new fields.NumberField({ initial: 0 }),

      damage: new fields.StringField({ initial: '' }),
      range: new fields.StringField({ initial: '' }),
      accuracy: new fields.NumberField({ initial: 0 }),
      attackSkill: new fields.StringField({ initial: '' }),
      rateOfFire: new fields.NumberField({ initial: 1 }),
      usingAmmo: new fields.BooleanField({ initial: false }),
      rollOnlyDmg: new fields.BooleanField({ initial: false }),

      enhancements: new fields.NumberField({ initial: 0 }),
      enhancementItemIds: new fields.ArrayField(new fields.StringField({ initial: '' })),

      armorPiercing: new fields.BooleanField({ initial: false }),
      improvedArmorPiercing: new fields.BooleanField({ initial: false }),
      ablating: new fields.BooleanField({ initial: false }),

      effects: new fields.ArrayField(new fields.SchemaField(itemEffect())),
    }

  }

  prepareDerivedData() {
    super.prepareDerivedData();

    let enhancementItemIds = this.enhancementItemIds;
    if (enhancementItemIds?.length > 0) {
      this.enhancementItems = []

      let items = this.parent.actor.items;

      enhancementItemIds.forEach(itemId => {
        let item = items.get(itemId);
        if (item) {
          this.enhancementItems.push({
            name: item.name,
            img: item.img,
            system: item.system,
            id: itemId,
          })
        }
      });
    }
  }

  /** @inheritdoc */
  static migrateData(source) {
    const migrated = super.migrateData(source) ?? source;

    if ("enhancementItems" in migrated) {
      migrated.enhancementItemIds = migrated.enhancementItemIds ?? []
      migrated.enhancementItems.forEach(enhancement => {
        if (Object.keys(enhancement).length !== 0 && !migrated.enhancementItemIds.includes(enhancement._id)) {
          migrated.enhancementItemIds.push(enhancement._id)
        }
      });
    }

    migrated.effects?.forEach(effect => effect.percentage = parseInt(effect.percentage))
    return migrated;
  }
}
