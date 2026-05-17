import CommonItemData from "./commonItemData.js";
import { getTransportAccessoryProfile } from "../../scripts/transport.mjs";

const fields = foundry.data.fields;

export default class ValuableData extends CommonItemData {

    static defineSchema() {
  
      const commonData = super.defineSchema();
      return {
        // Using destructuring to effectively append our additional data here
        ...commonData,
        type: new fields.StringField({initial: ''}),
        avail: new fields.StringField({initial: ''}),
        effect: new fields.StringField({initial: ''}),
        conceal: new fields.StringField({initial: ''}),
        quality: new fields.StringField({initial: ''}),
        transportSlot: new fields.StringField({initial: ''}),
        controlBonus: new fields.NumberField({initial: 0}),
        speedBonus: new fields.NumberField({initial: 0}),
        spBonus: new fields.NumberField({initial: 0}),
        hpBonus: new fields.NumberField({initial: 0}),
        occupancyBonus: new fields.NumberField({initial: 0}),
        cargoCapacity: new fields.NumberField({initial: 0}),
        improvementCost: new fields.NumberField({initial: 0}),
        transportKinds: new fields.ArrayField(new fields.StringField()),
        improvementGroup: new fields.StringField({initial: ''}),
      }
    }

    prepareDerivedData() {
      super.prepareDerivedData();
      if (this.type === "mount-accessories") {
        this.transportProfile = getTransportAccessoryProfile(this.parent);
      }
    }
  }
