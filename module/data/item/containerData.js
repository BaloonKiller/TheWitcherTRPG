import CommonItemData from "./commonItemData.js";
import { fromUuidSync } from "../../setup/foundry-compat.js";
import {
  getContainerState,
  migrateContainerSystemData,
} from "../../scripts/containerStorage.mjs";
import { resolveActorOwnedItems } from "../../scripts/storedItems.mjs";

const fields = foundry.data.fields;

export default class ContainerData extends CommonItemData {

    static defineSchema() {
  
      const commonData = super.defineSchema();
      return {
        // Using destructuring to effectively append our additional data here
        ...commonData,
        carry: new fields.NumberField({initial: 0}),
        capacity: new fields.NumberField({nullable: true, initial: null}),
        content: new fields.ArrayField(new fields.StringField())
      }
    }

    prepareDerivedData() {
      super.prepareDerivedData();
  
      const contentItems = resolveActorOwnedItems(
        this.content,
        this.parent.actor,
        fromUuidSync,
      ).filter(item => item.uuid !== this.parent.uuid);
      const state = getContainerState(this, contentItems);

      this.itemContent = contentItems.map(item => ({
        id: item.id,
        name: item.name,
        img: item.img,
        quantity: item.system.quantity,
        weight: item.system.weight,
        description: item.system.description,
        uuid: item.uuid,
      }));
      this.containerCapacity = state.capacity;
      this.containerContentWeight = state.weight;
      this.containerTotalWeight = Number((Math.max(0, Number(this.weight) || 0) + state.weight).toFixed(3));
      this.containerRemainingCapacity = state.remaining;
      this.containerOverloaded = state.overloaded;
      this.containerFillPercent = state.fillPercent;
    }

    static migrateData(source) {
      const migrated = super.migrateData(source) ?? source;
      return migrateContainerSystemData(migrated);
    }
  }
