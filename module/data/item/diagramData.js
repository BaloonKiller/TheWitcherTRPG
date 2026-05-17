import CommonItemData from "./commonItemData.js";
import craftingComponent from "./templates/craftingComponentData.js";
import { fromUuidSync } from "../../setup/foundry-compat.js";

const fields = foundry.data.fields;

export default class DiagramData extends CommonItemData {

    static defineSchema() {
  
      const commonData = super.defineSchema();
      return {
        // Using destructuring to effectively append our additional data here
        ...commonData,
        type: new fields.StringField({initial: ''}),
        level: new fields.StringField({initial: ''}),
        isFormulae: new fields.BooleanField({initial: false}),
        craftingDC: new fields.NumberField({initial: 0}),
        alchemyDC: new fields.NumberField({initial: 0}),
        craftingTime: new fields.StringField({initial: ''}),
        investment: new fields.NumberField({initial: 0}),
        learned: new fields.BooleanField({initial: false}),
        outputQuantity: new fields.NumberField({initial: 1}),

        craftingComponents: new fields.ArrayField(new fields.SchemaField(craftingComponent())),
        alchemyComponents: new fields.SchemaField({
          vitriol: new fields.NumberField({initial: 0}),
          rebis: new fields.NumberField({initial: 0}),
          aether: new fields.NumberField({initial: 0}),
          quebrith: new fields.NumberField({initial: 0}),
          hydragenum: new fields.NumberField({initial: 0}),
          vermilion: new fields.NumberField({initial: 0}),
          sol: new fields.NumberField({initial: 0}),
          caelum: new fields.NumberField({initial: 0}),
          fulgur: new fields.NumberField({initial: 0}),
        }),

        associatedItemUuid: new fields.StringField({initial: ''}),
      }
    }

    prepareDerivedData() {
      super.prepareDerivedData();
  
      let itemUuid = this.associatedItemUuid;
      if(itemUuid) {
          this.associatedItem = fromUuidSync(itemUuid) ?? null;
      }
      this.hasPhysicalCopy = Number(this.quantity) > 0 && !this.isStored;
      this.canCraft = this.learned || this.hasPhysicalCopy;
    }

     /** @inheritdoc */
     static migrateData(source) {
      const migrated = super.migrateData(source) ?? source;

      if ("associatedItem" in migrated) {
        migrated.associatedItemUuid = migrated.associatedItem?.uuid
          ?? (migrated.associatedItem?._id ? "Compendium.thewitchertrpg.gear.Item." + migrated.associatedItem._id : "");
      }
      migrated.craftingComponents = (migrated.craftingComponents ?? [])
        .filter(component => component?.name || Number(component?.quantity) > 0)
        .map(component => ({
          ...component,
          quantity: Number(component.quantity) > 0 ? Number(component.quantity) : 1,
        }));
      const legacyOutputQuantity = Number(migrated.associatedItem?.system?.quantity);
      migrated.outputQuantity = Number(migrated.outputQuantity) > 0
        ? Math.floor(Number(migrated.outputQuantity))
        : (legacyOutputQuantity > 0 ? Math.floor(legacyOutputQuantity) : 1);
      return migrated;
    }
  }
