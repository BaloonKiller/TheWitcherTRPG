import WitcherItemSheet from "./WitcherItemSheet.js";
import {
  buildTransportStorageUpdate,
  calculateItemStackWeight,
  calculateStoredItemsWeight,
  getTransportAccessoryProfile,
  getTransportCargoState,
  getTransportDerivedStats,
  inferTransportKind,
  parseControlModifier,
  usesPullingAnimalSpeed,
} from "../../scripts/transport.mjs";
import {
  openMountAthleticsRoll,
  openTransportControlRoll,
  openTransportDamageDialog,
  openTransportRepairRoll,
} from "../../scripts/transportActions.js";
import { prepareApplicationTab } from "../../scripts/applicationTabs.mjs";
import { buildTransportDocumentUpdate } from "../../scripts/documentUpdates.mjs";
import {
  findStackableInventoryItem,
  findStackableStoredItem,
  getItemQuantityTransfer,
  getSingleItemTransfer,
} from "../../scripts/inventoryDrops.mjs";
import { findOrphanedStoredItems, resolveActorOwnedItems } from "../../scripts/storedItems.mjs";
import {
  TextEditor,
  WitcherDialog,
  fromUuid,
  fromUuidSync,
  renderApplication,
  renderDocumentSheet,
} from "../../setup/foundry-compat.js";

export default class WitcherMountSheet extends WitcherItemSheet {
  storableItems = [
    "weapon",
    "armor",
    "enhancement",
    "valuable",
    "alchemical",
    "component",
    "diagrams",
    "mutagen",
    "container",
  ]

  static DEFAULT_OPTIONS = {
    classes: ["transport-sheet"],
    position: {
      width: 620,
      height: 620,
    },
  };

  static TABS = {
    primary: {
      initial: "description",
      tabs: [
        { id: "description" },
        { id: "attributes" },
        { id: "loadout" },
      ],
    },
  };

  get template() {
    return "systems/thewitchertrpg/templates/sheets/mount-sheet.hbs";
  }

  _prepareSubmitData(event, form, formData, updateData) {
    return this.#preserveStorage(super._prepareSubmitData(event, form, formData, updateData));
  }

  getData() {
    const data = super.getData();
    const system = this.item.system;
    const accessoryDocuments = this.#resolveStoredItems(system.accessories);
    const cargoDocuments = this.#resolveStoredItems(system.cargo);
    const pullingAnimal = this.item.actor?.items?.get(system.pullerId) ?? null;
    const derived = getTransportDerivedStats(this.item, accessoryDocuments, pullingAnimal);
    const cargoState = getTransportCargoState(this.item, accessoryDocuments, cargoDocuments, this.item.actor?.items);
    const kind = derived.kind;
    const pullingAnimals = Array.from(this.item.actor?.items ?? [])
      .filter(item => item.type === "mount" && item.id !== this.item.id && inferTransportKind(item) === "mount")
      .map(item => ({
        id: item.id,
        name: item.name,
        speed: item.system.transportEffectiveSpeed ?? item.system.transportSpeed ?? item.system.speed,
      }));
    data.transport = {
      kind,
      controlSkill: derived.controlSkill,
      baseControl: parseControlModifier(system.control),
      control: derived.control,
      speed: derived.speed,
      hp: derived.hp,
      sp: derived.sp,
      occupancy: derived.occupancy,
      cargoCapacity: derived.cargoCapacity,
      cargoWeight: cargoState.weight,
      improvementSlots: derived.improvementSlots,
      pullerId: system.pullerId,
      pullingAnimals,
      accessories: accessoryDocuments.map(item => this.#prepareStoredItem(item, true)),
      cargo: cargoDocuments.map(item => this.#prepareStoredItem(item)),
      isMount: kind === "mount",
      isWagon: kind === "wagon",
      usesPullingAnimal: usesPullingAnimalSpeed(this.item),
      hasCargoCapacity: derived.cargoCapacity !== null,
      cargoBlocked: kind === "mount" && !(derived.cargoCapacity > 0),
      cargoOverloaded: cargoState.overloaded,
      canRepair: kind !== "mount",
      isOwned: Boolean(this.item.actor),
    };
    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find(".transport-remove-item").on("click", this._onRemoveStoredItem.bind(this));
    html.find(".transport-unload-all").on("click", this._onUnloadAllCargo.bind(this));
    html.find(".transport-contained-edit").on("click", this._onEditStoredItem.bind(this));
    html.find(".transport-container-open").on("click", this._onOpenStoredContainer.bind(this));
    html.find(".transport-control").on("click", event => this._runAction(event, openTransportControlRoll));
    html.find(".transport-athletics").on("click", event => this._runAction(event, openMountAthleticsRoll));
    html.find(".transport-damage").on("click", event => this._runAction(event, (_actor, item) => openTransportDamageDialog(item)));
    html.find(".transport-repair").on("click", event => this._runAction(event, openTransportRepairRoll));
  }

  openLoadout() {
    prepareApplicationTab(this, "loadout");
    return renderApplication(this);
  }

  async _onDrop(event) {
    event.preventDefault();
    const droppedItem = await this.#getDroppedItem(event);
    const actor = this.item.actor;
    if (!droppedItem || !actor || droppedItem.parent?.uuid !== actor.uuid) {
      return ui.notifications.warn(game.i18n.localize("WITCHER.Transport.SameActorRequired"));
    }
    if (droppedItem.id === this.item.id || droppedItem.type === "mount") return false;
    const isOrphaned = findOrphanedStoredItems(actor.items).includes(droppedItem);
    if (droppedItem.system.isStored && !isOrphaned) {
      return ui.notifications.warn(game.i18n.localize("WITCHER.Transport.AlreadyStored"));
    }

    if (droppedItem.type === "valuable" && droppedItem.system.type === "mount-accessories") {
      return this.#attachAccessory(droppedItem);
    }
    if (!this.storableItems.includes(droppedItem.type)) {
      return ui.notifications.warn(game.i18n.localize("WITCHER.Transport.CannotStore"));
    }
    return this.#storeCargo(droppedItem);
  }

  async _onRemoveStoredItem(event) {
    event.preventDefault();
    const uuid = event.currentTarget.dataset.uuid;
    const collection = event.currentTarget.dataset.collection;
    if (!uuid || !["accessories", "cargo"].includes(collection)) return false;

    const storedItems = this.#resolveStoredItems(this.item.system[collection]);
    const storedItem = storedItems.find(item => item.uuid === uuid) ?? null;
    if (!storedItem) return false;

    if (collection === "cargo") {
      const transfer = await this.#chooseCargoUnloadQuantity(storedItem);
      if (!transfer) return false;
      if (transfer.remaining > 0) {
        await this.#releaseStoredItemQuantity(storedItem, transfer);
        await renderApplication(this);
        return true;
      }
    }

    const contents = storedItems.filter(item => item.uuid !== uuid).map(item => item.uuid);
    const update = buildTransportStorageUpdate(this.item.system, collection, contents);
    const cargoItems = this.#resolveStoredItems(this.item.system.cargo);
    let unloadedCargo = [];

    if (collection === "accessories") {
      const remainingAccessories = storedItems.filter(item => item.uuid !== uuid);
      const cargoState = getTransportCargoState(this.item, remainingAccessories, cargoItems, this.item.actor?.items);
      if (cargoState.overloaded) {
        update["system.cargo"] = [];
        unloadedCargo = cargoItems;
      }
    }

    await this.item.update(update);
    await this.#releaseStoredItems([storedItem, ...unloadedCargo]);
    if (unloadedCargo.length > 0) this.#notifyCargoUnloaded(unloadedCargo.length);
    return true;
  }

  async _onUnloadAllCargo(event) {
    event.preventDefault();
    const cargoItems = this.#resolveStoredItems(this.item.system.cargo);
    if (cargoItems.length === 0) return false;

    await this.item.update(buildTransportStorageUpdate(this.item.system, "cargo", []));
    await this.#releaseStoredItems(cargoItems);
    this.#notifyCargoUnloaded(cargoItems.length);
    return true;
  }

  _onEditStoredItem(event) {
    event.preventDefault();
    const item = fromUuidSync(event.currentTarget.dataset.uuid);
    if (item) renderDocumentSheet(item);
  }

  async _onOpenStoredContainer(event) {
    event.preventDefault();
    event.stopPropagation();
    const [container] = this.#resolveStoredItems([event.currentTarget.dataset.uuid]);
    if (container?.type !== "container" || !container.sheet) return false;

    if (typeof container.sheet.openContents === "function") {
      await container.sheet.openContents();
    } else {
      await renderDocumentSheet(container);
    }
    return true;
  }

  _runAction(event, action) {
    event.preventDefault();
    return action(this.item.actor, this.item);
  }

  async #attachAccessory(accessory) {
    const existingItems = this.#resolveStoredItems(this.item.system.accessories);
    const accessories = existingItems.map(item => item.uuid);
    if (accessories.includes(accessory.uuid)) return false;

    const profile = getTransportAccessoryProfile(accessory);
    const transportKind = inferTransportKind(this.item);
    if (profile.transportKinds.length > 0 && !profile.transportKinds.includes(transportKind)) {
      return ui.notifications.warn(game.i18n.localize("WITCHER.Transport.IncompatibleAccessory"));
    }
    if (!["other", "upgrade"].includes(profile.slot)
      && existingItems.some(item => getTransportAccessoryProfile(item).slot === profile.slot)) {
      return ui.notifications.warn(game.i18n.format("WITCHER.Transport.SlotOccupied", {
        slot: game.i18n.localize(`WITCHER.Transport.Slot.${profile.slot}`),
      }));
    }

    if (profile.slot === "upgrade") {
      if (existingItems.some(item => item.name === accessory.name)) {
        return ui.notifications.warn(game.i18n.localize("WITCHER.Transport.ImprovementAlreadyInstalled"));
      }
      if (profile.improvementGroup && existingItems.some(item => (
        getTransportAccessoryProfile(item).improvementGroup === profile.improvementGroup
      ))) {
        return ui.notifications.warn(game.i18n.localize("WITCHER.Transport.IncompatibleImprovement"));
      }
      const stats = getTransportDerivedStats(this.item, existingItems);
      const cost = Math.max(1, profile.improvementCost || 0);
      if (stats.improvementSlots.used + cost > stats.improvementSlots.max) {
        return ui.notifications.warn(game.i18n.localize("WITCHER.Transport.NoImprovementSlot"));
      }
    }

    const transfer = await this.#takeSingleAccessory(accessory);
    try {
      await this.item.update(buildTransportStorageUpdate(
        this.item.system,
        "accessories",
        [...accessories, transfer.item.uuid],
      ));
    } catch (error) {
      await transfer.rollback();
      throw error;
    }
    return true;
  }

  async #takeSingleAccessory(accessory) {
    const actor = this.item.actor;
    if (!actor) throw new Error("Cannot mount an accessory without an owning Actor.");
    const originalQuantity = accessory.system.quantity;
    const transfer = getSingleItemTransfer(accessory.system.quantity);
    if (transfer.remaining === 0) {
      await accessory.update({ "system.isStored": true, "system.quantity": transfer.transferred });
      return {
        item: accessory,
        rollback: () => accessory.update({
          "system.isStored": false,
          "system.quantity": originalQuantity,
        }),
      };
    }

    const itemData = accessory.toObject();
    delete itemData._id;
    itemData.system.quantity = transfer.transferred;
    itemData.system.isStored = true;
    const [mountedAccessory] = await actor.createEmbeddedDocuments("Item", [itemData]);
    try {
      await accessory.update({ "system.quantity": transfer.remaining });
    } catch (error) {
      await mountedAccessory.delete();
      throw error;
    }

    return {
      item: mountedAccessory,
      rollback: async () => {
        await accessory.update({ "system.quantity": transfer.remaining + transfer.transferred });
        await mountedAccessory.delete();
      },
    };
  }

  #preserveStorage(formData) {
    return buildTransportDocumentUpdate(formData, {
      pullerId: this.item.system.pullerId,
      accessories: this.#resolveStoredItems(this.item.system.accessories).map(item => item.uuid),
      cargo: this.#resolveStoredItems(this.item.system.cargo).map(item => item.uuid),
    });
  }

  #prepareStoredItem(item, includeProfile = false) {
    const quantity = this.#inventoryQuantity(item.system.quantity, 1);
    const weight = Number(item.system.weight) || 0;
    const isContainer = item.type === "container";
    const totalWeight = isContainer
      ? calculateStoredItemsWeight([item], this.item.actor?.items)
      : calculateItemStackWeight(quantity, weight);
    return {
      id: item.id,
      uuid: item.uuid,
      name: item.name,
      img: item.img,
      quantity,
      weight,
      isContainer,
      isStacked: quantity > 1,
      totalWeight,
      description: item.system.description,
      ...(includeProfile ? { profile: getTransportAccessoryProfile(item) } : {}),
    };
  }

  #resolveStoredItems(references) {
    return resolveActorOwnedItems(references, this.item.actor, fromUuidSync)
      .filter(item => item.uuid !== this.item.uuid);
  }

  async #releaseStoredItems(items) {
    for (const item of items.filter(Boolean)) {
      const canConsolidate = !["container", "diagrams", "mount"].includes(item.type);
      const target = canConsolidate
        ? findStackableInventoryItem(this.item.actor?.items, item)
        : null;
      if (!target || target.id === item.id) {
        await item.update({ "system.isStored": false });
        continue;
      }

      const targetQuantity = this.#inventoryQuantity(target.system.quantity, 0);
      const releasedQuantity = this.#inventoryQuantity(item.system.quantity, 1);
      await target.update({ "system.quantity": targetQuantity + releasedQuantity });
      try {
        await item.delete();
      } catch (error) {
        await target.update({ "system.quantity": targetQuantity });
        throw error;
      }
    }
  }

  async #chooseCargoUnloadQuantity(item) {
    const available = this.#inventoryQuantity(item.system.quantity, 1);
    if (available <= 1) return getItemQuantityTransfer(available, 1);

    return new Promise(async resolve => {
      let settled = false;
      const settle = transfer => {
        if (settled) return;
        settled = true;
        resolve(transfer);
      };
      const getRequestedQuantity = html => {
        const jqueryValue = typeof html?.find === "function"
          ? html.find("input[name='quantity']").val()
          : null;
        const root = html?.querySelector ? html : html?.[0];
        return jqueryValue ?? root?.querySelector("input[name='quantity']")?.value ?? null;
      };
      const dialog = new WitcherDialog({
        title: game.i18n.format("WITCHER.Transport.UnloadTitle", { item: item.name }),
        content: `<div class="transport-quantity-dialog">
          <label>
            <span>${game.i18n.localize("WITCHER.Transport.UnloadQuantity")}</span>
            <span><input type="number" name="quantity" value="1" min="1" max="${available}" step="1"> / ${available}</span>
          </label>
        </div>`,
        buttons: {
          continue: {
            label: game.i18n.localize("WITCHER.Button.Continue"),
            callback: html => {
              const transfer = getItemQuantityTransfer(available, getRequestedQuantity(html));
              if (!transfer) ui.notifications.error(game.i18n.localize("WITCHER.Items.InvalidQuantity"));
              settle(transfer);
            },
          },
          all: {
            label: game.i18n.localize("WITCHER.Button.All"),
            callback: () => settle(getItemQuantityTransfer(available, available)),
          },
        },
        close: () => settle(null),
      }, {
        width: 300,
      });
      await renderApplication(dialog);
    });
  }

  async #releaseStoredItemQuantity(item, transfer) {
    const actor = this.item.actor;
    if (!actor) throw new Error("Cannot unload cargo without an owning Actor.");

    const canConsolidate = !["container", "diagrams", "mount"].includes(item.type);
    const target = canConsolidate ? findStackableInventoryItem(actor.items, item) : null;
    if (target && target.id !== item.id) {
      const targetQuantity = this.#inventoryQuantity(target.system.quantity, 0);
      await target.update({ "system.quantity": targetQuantity + transfer.transferred });
      try {
        await item.update({ "system.quantity": transfer.remaining });
      } catch (error) {
        await target.update({ "system.quantity": targetQuantity });
        throw error;
      }
      return;
    }

    const itemData = item.toObject();
    delete itemData._id;
    itemData.system.quantity = transfer.transferred;
    itemData.system.isStored = false;
    const [releasedItem] = await actor.createEmbeddedDocuments("Item", [itemData]);
    try {
      await item.update({ "system.quantity": transfer.remaining });
    } catch (error) {
      await releasedItem.delete();
      throw error;
    }
  }

  #inventoryQuantity(quantity, fallback) {
    const parsed = Number(quantity);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  #notifyCargoUnloaded(count) {
    ui.notifications.info(game.i18n.format("WITCHER.Transport.CargoUnloadedAfterCapacityLoss", { count }));
  }

  async #storeCargo(item) {
    const cargoItems = this.#resolveStoredItems(this.item.system.cargo);
    const cargo = cargoItems.map(storedItem => storedItem.uuid);
    if (cargo.includes(item.uuid)) return false;

    const accessories = this.#resolveStoredItems(this.item.system.accessories);
    const cargoState = getTransportCargoState(
      this.item,
      accessories,
      [...cargoItems, item],
      this.item.actor?.items,
    );
    if (cargoState.blocked) {
      return ui.notifications.warn(game.i18n.localize("WITCHER.Transport.CargoRequiresStorage"));
    }
    if (cargoState.overloaded) {
      return ui.notifications.warn(game.i18n.localize("WITCHER.Transport.CargoCapacityExceeded"));
    }

    const stackTarget = findStackableStoredItem(cargoItems, item);
    if (stackTarget) {
      const targetQuantity = this.#inventoryQuantity(stackTarget.system.quantity, 0);
      const storedQuantity = this.#inventoryQuantity(item.system.quantity, 1);
      await stackTarget.update({ "system.quantity": targetQuantity + storedQuantity });
      try {
        await item.delete();
      } catch (error) {
        await stackTarget.update({ "system.quantity": targetQuantity });
        throw error;
      }
      await renderApplication(this);
      return true;
    }

    const storageUpdate = buildTransportStorageUpdate(
      this.item.system,
      "cargo",
      [...cargo, item.uuid],
    );
    const actor = this.item.actor;
    if (typeof actor?.updateEmbeddedDocuments === "function") {
      await actor.updateEmbeddedDocuments("Item", [
        { _id: this.item.id, ...storageUpdate },
        { _id: item.id, "system.isStored": true },
      ]);
    } else {
      await this.item.update(storageUpdate);
      await item.update({ "system.isStored": true });
    }
    return true;
  }

  async #getDroppedItem(event) {
    const data = TextEditor.getDragEventData(event);
    if (data.uuid) return fromUuid(data.uuid);

    const actorId = data.actor?.id ?? data.actor?._id;
    const itemId = data.item?.id ?? data.item?._id;
    const currentActor = this.item.actor;
    if (currentActor && itemId && (!actorId || currentActor.id === actorId)) {
      return currentActor.items.get(itemId) ?? null;
    }
    return game.actors?.get(actorId)?.items?.get(itemId) ?? null;
  }
}
