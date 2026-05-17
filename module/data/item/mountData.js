import CommonItemData from "./commonItemData.js";
import { fromUuidSync } from "../../setup/foundry-compat.js";
import {
  calculateStoredItemsWeight,
  getTransportAccessoryProfile,
  getTransportDerivedStats,
  migrateTransportSystemData,
} from "../../scripts/transport.mjs";
import { resolveActorOwnedItems } from "../../scripts/storedItems.mjs";

const fields = foundry.data.fields;

export default class MountData extends CommonItemData {

    static defineSchema() {
  
      const commonData = super.defineSchema();
      return {
        // Using destructuring to effectively append our additional data here
        ...commonData,
        kind: new fields.StringField({initial: ''}),
        controlSkill: new fields.StringField({initial: ''}),
        dex: new fields.StringField({initial: ''}),
        control: new fields.StringField({initial: ''}),
        speed: new fields.StringField({initial: ''}),
        hp: new fields.NumberField({initial: 0}),
        hpCurrent: new fields.NumberField({nullable: true, initial: null}),
        sp: new fields.NumberField({initial: 0}),
        occupancy: new fields.NumberField({initial: 0}),
        improvementSlots: new fields.NumberField({initial: 0}),
        pullers: new fields.StringField({initial: ''}),
        pullerId: new fields.StringField({initial: ''}),
        cargoCapacity: new fields.NumberField({nullable: true, initial: null}),
        accessories: new fields.ArrayField(new fields.StringField()),
        cargo: new fields.ArrayField(new fields.StringField()),
      }
    }

    prepareDerivedData() {
      super.prepareDerivedData();

      this.transportAccessoryItems = this.#resolveItems(this.accessories).map(item => ({
        id: item.id,
        uuid: item.uuid,
        name: item.name,
        img: item.img,
        quantity: item.system.quantity,
        weight: item.system.weight,
        description: item.system.description,
        profile: getTransportAccessoryProfile(item),
      }));
      this.transportCargoItems = this.#resolveItems(this.cargo).map(item => ({
        id: item.id,
        uuid: item.uuid,
        name: item.name,
        img: item.img,
        quantity: item.system.quantity,
        weight: item.system.weight,
        description: item.system.description,
      }));

      const accessoryDocuments = this.#resolveItems(this.accessories);
      const pullingAnimal = this.parent.actor?.items?.get(this.pullerId) ?? null;
      const derived = getTransportDerivedStats(this.parent, accessoryDocuments, pullingAnimal);
      this.transportKind = derived.kind;
      this.transportControlSkill = derived.controlSkill;
      this.transportControl = derived.control;
      this.transportSpeed = derived.speed;
      this.transportEffectiveSpeed = derived.speed;
      this.transportHp = derived.hp;
      this.transportSp = derived.sp;
      this.transportOccupancy = derived.occupancy;
      this.transportCargoCapacity = derived.cargoCapacity;
      this.transportHasCargoCapacity = derived.cargoCapacity !== null;
      this.transportCargoWeight = calculateStoredItemsWeight(
        this.#resolveItems(this.cargo),
        this.parent.actor?.items,
      );
      this.transportImprovementSlots = derived.improvementSlots;
      this.transportPullingAnimal = pullingAnimal;
      this.transportPullingAnimalName = pullingAnimal?.name ?? '';
    }

    static migrateData(source) {
      const migrated = super.migrateData(source) ?? source;
      return migrateTransportSystemData(migrated);
    }

    #resolveItems(uuids) {
      return resolveActorOwnedItems(uuids, this.parent.actor, fromUuidSync)
        .filter(item => item.uuid !== this.parent.uuid);
    }
  }
