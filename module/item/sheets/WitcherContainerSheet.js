import WitcherItemSheet from "./WitcherItemSheet.js";
import {
  buildContainerStorageUpdate,
  getContainerState,
  getContainerTransferLimit,
} from "../../scripts/containerStorage.mjs";
import { buildContainerDocumentUpdate } from "../../scripts/documentUpdates.mjs";
import {
  findStackableInventoryItem,
  findStackableStoredItem,
  getItemQuantityTransfer,
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

export default class WitcherContainerSheet extends WitcherItemSheet {
  storableItems = [
    "weapon",
    "armor",
    "enhancement",
    "valuable",
    "alchemical",
    "component",
    "diagrams",
    "mutagen",
  ]

  static DEFAULT_OPTIONS = {
    classes: ["container-sheet"],
    position: {
      width: 640,
      height: 640,
    },
  };

  get template() {
    return "systems/thewitchertrpg/templates/sheets/container-sheet.hbs";
  }

  openContents() {
    return renderApplication(this);
  }

  _prepareSubmitData(event, form, formData, updateData) {
    return this.#preserveStorage(super._prepareSubmitData(event, form, formData, updateData));
  }

  getData() {
    const data = super.getData();
    const contentItems = this.#resolveStoredItems();
    const state = getContainerState(this.item, contentItems);
    data.container = {
      ...state,
      hasCapacity: state.capacity !== null,
      isOwned: Boolean(this.item.actor),
      items: contentItems.map(item => this.#prepareStoredItem(item)),
    };
    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find(".container-remove-item").on("click", this._onRemoveItem.bind(this));
    html.find(".container-unload-all").on("click", this._onUnloadAll.bind(this));
    html.find(".container-contained-edit").on("click", this._onEditStoredItem.bind(this));
    this.#synchronizeStoredFlags().catch(error => {
      console.warn("TheWitcherTRPG | Could not synchronize container contents.", error);
    });
  }

  async _onDrop(event) {
    event.preventDefault();
    const item = await this.#getDroppedItem(event);
    const actor = this.item.actor;
    if (!item || !actor || item.parent?.uuid !== actor.uuid) {
      return ui.notifications.warn(game.i18n.localize("WITCHER.Container.SameActorRequired"));
    }
    if (item.id === this.item.id || !this.storableItems.includes(item.type)) {
      return ui.notifications.warn(game.i18n.localize("WITCHER.Container.CannotStore"));
    }

    await this.#synchronizeStoredFlags();
    const isOrphaned = findOrphanedStoredItems(actor.items).includes(item);
    if (item.system.isStored && !isOrphaned) {
      return ui.notifications.warn(game.i18n.localize("WITCHER.Container.AlreadyStored"));
    }
    return this.#storeItem(item);
  }

  async _onRemoveItem(event) {
    event.preventDefault();
    const item = this.#resolveStoredItems().find(stored => stored.uuid === event.currentTarget.dataset.uuid);
    if (!item) return false;

    const available = this.#inventoryQuantity(item.system.quantity, 1);
    const transfer = await this.#chooseQuantity(item, available, "Unload");
    if (!transfer) return false;

    if (transfer.remaining > 0) {
      await this.#releaseStoredItemQuantity(item, transfer);
      await this.#refreshParentTransports();
      await renderApplication(this);
      return true;
    }

    return this.#releaseEntireStoredItem(item);
  }

  async _onUnloadAll(event) {
    event.preventDefault();
    const items = this.#resolveStoredItems();
    if (items.length === 0) return false;

    for (const item of items) await this.#releaseEntireStoredItem(item, false, false);
    await this.#refreshParentTransports();
    await renderApplication(this);
    ui.notifications.info(game.i18n.format("WITCHER.Container.UnloadedAll", { count: items.length }));
    return true;
  }

  _onEditStoredItem(event) {
    event.preventDefault();
    const item = fromUuidSync(event.currentTarget.dataset.uuid);
    if (item) renderDocumentSheet(item);
  }

  async #storeItem(item) {
    const actor = this.item.actor;
    const contentItems = this.#resolveStoredItems();
    const maximum = getContainerTransferLimit(this.item, contentItems, item);
    if (maximum < 1) {
      return ui.notifications.warn(game.i18n.localize("WITCHER.Container.CapacityExceeded"));
    }

    const transfer = await this.#chooseQuantity(item, maximum, "Store");
    if (!transfer) return false;

    const stackTarget = findStackableStoredItem(contentItems, item);
    if (stackTarget) {
      const originalTargetQuantity = this.#inventoryQuantity(stackTarget.system.quantity, 0);
      await stackTarget.update({
        "system.quantity": originalTargetQuantity + transfer.transferred,
      });
      try {
        if (transfer.remaining > 0) {
          await item.update({ "system.quantity": transfer.remaining });
        } else {
          await item.delete();
        }
      } catch (error) {
        await stackTarget.update({ "system.quantity": originalTargetQuantity });
        throw error;
      }
      await this.#refreshParentTransports();
      await renderApplication(this);
      return true;
    }

    const originalContent = this.#contentReferences();
    if (transfer.remaining === 0) {
      await this.item.update(buildContainerStorageUpdate([...originalContent, item.uuid]));
      try {
        await item.update({ "system.isStored": true });
      } catch (error) {
        await this.item.update(buildContainerStorageUpdate(originalContent));
        throw error;
      }
      await this.#refreshParentTransports();
      return true;
    }

    const itemData = item.toObject();
    delete itemData._id;
    itemData.system.quantity = transfer.transferred;
    itemData.system.isStored = true;
    const [storedItem] = await actor.createEmbeddedDocuments("Item", [itemData]);
    let sourceUpdated = false;
    try {
      await item.update({ "system.quantity": transfer.remaining });
      sourceUpdated = true;
      await this.item.update(buildContainerStorageUpdate([...originalContent, storedItem.uuid]));
    } catch (error) {
      if (sourceUpdated) {
        await item.update({ "system.quantity": transfer.remaining + transfer.transferred });
      }
      await storedItem.delete();
      throw error;
    }
    await this.#refreshParentTransports();
    return true;
  }

  async #releaseEntireStoredItem(item, render = true, refreshTransport = true) {
    const originalContent = this.#contentReferences();
    const remainingContent = originalContent.filter(uuid => uuid !== item.uuid);
    await this.item.update(buildContainerStorageUpdate(remainingContent));

    try {
      await this.#releaseStoredItem(item);
    } catch (error) {
      await this.item.update(buildContainerStorageUpdate(originalContent));
      throw error;
    }
    if (refreshTransport) await this.#refreshParentTransports();
    if (render) await renderApplication(this);
    return true;
  }

  async #releaseStoredItem(item) {
    const actor = this.item.actor;
    const canConsolidate = !["container", "diagrams", "mount"].includes(item.type);
    const target = canConsolidate ? findStackableInventoryItem(actor?.items, item) : null;
    if (!target || target.id === item.id) {
      await item.update({ "system.isStored": false });
      return;
    }

    const originalTargetQuantity = this.#inventoryQuantity(target.system.quantity, 0);
    const releasedQuantity = this.#inventoryQuantity(item.system.quantity, 1);
    await target.update({ "system.quantity": originalTargetQuantity + releasedQuantity });
    try {
      await item.delete();
    } catch (error) {
      await target.update({ "system.quantity": originalTargetQuantity });
      throw error;
    }
  }

  async #releaseStoredItemQuantity(item, transfer) {
    const actor = this.item.actor;
    if (!actor) throw new Error("Cannot unload a container without an owning Actor.");

    const canConsolidate = !["container", "diagrams", "mount"].includes(item.type);
    const target = canConsolidate ? findStackableInventoryItem(actor.items, item) : null;
    if (target && target.id !== item.id) {
      const originalTargetQuantity = this.#inventoryQuantity(target.system.quantity, 0);
      await target.update({ "system.quantity": originalTargetQuantity + transfer.transferred });
      try {
        await item.update({ "system.quantity": transfer.remaining });
      } catch (error) {
        await target.update({ "system.quantity": originalTargetQuantity });
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

  #chooseQuantity(item, maximum, action) {
    const available = this.#inventoryQuantity(item.system.quantity, 1);
    const allowed = Math.min(available, Math.max(0, Math.floor(maximum)));
    if (allowed < 1) return Promise.resolve(null);
    if (available === 1) return Promise.resolve(getItemQuantityTransfer(available, 1));

    return new Promise(resolve => {
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
        title: game.i18n.format(`WITCHER.Container.${action}Title`, { item: item.name }),
        content: `<div class="container-quantity-dialog">
          <label>
            <span>${game.i18n.localize(`WITCHER.Container.${action}Quantity`)}</span>
            <span><input type="number" name="quantity" value="1" min="1" max="${allowed}" step="1"> / ${allowed}</span>
          </label>
        </div>`,
        buttons: {
          continue: {
            label: game.i18n.localize("WITCHER.Button.Continue"),
            callback: html => {
              const transfer = getItemQuantityTransfer(available, getRequestedQuantity(html));
              if (!transfer || transfer.transferred > allowed) {
                ui.notifications.error(game.i18n.localize("WITCHER.Items.InvalidQuantity"));
                settle(null);
                return;
              }
              settle(transfer);
            },
          },
          maximum: {
            label: game.i18n.localize("WITCHER.Container.Maximum"),
            callback: () => settle(getItemQuantityTransfer(available, allowed)),
          },
        },
        close: () => settle(null),
      }, {
        width: 320,
      });
      renderApplication(dialog).catch(() => settle(null));
    });
  }

  #preserveStorage(formData) {
    return buildContainerDocumentUpdate(formData, {
      content: this.#contentReferences(),
    });
  }

  #prepareStoredItem(item) {
    const quantity = this.#inventoryQuantity(item.system.quantity, 1);
    const weight = Math.max(0, Number(item.system.weight) || 0);
    return {
      id: item.id,
      uuid: item.uuid,
      name: item.name,
      img: item.img,
      quantity,
      weight,
      totalWeight: Number((quantity * weight).toFixed(3)),
      description: item.system.description,
    };
  }

  #contentReferences() {
    return this.#resolveStoredItems().map(item => item.uuid);
  }

  #resolveStoredItems() {
    return resolveActorOwnedItems(this.item.system.content, this.item.actor, fromUuidSync)
      .filter(item => item.uuid !== this.item.uuid);
  }

  #inventoryQuantity(quantity, fallback) {
    const parsed = Number(quantity);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
  }

  async #synchronizeStoredFlags() {
    if (!this.item.isOwner) return;
    const inconsistentItems = this.#resolveStoredItems().filter(item => !item.system.isStored);
    await Promise.all(inconsistentItems.map(item => item.update({ "system.isStored": true })));
  }

  async #refreshParentTransports() {
    const actor = this.item.actor;
    if (!actor) return;
    const references = new Set([this.item.uuid, this.item.id]);
    const parentTransports = Array.from(actor.items ?? []).filter(item => (
      item.type === "mount"
      && Array.from(item.system?.cargo ?? []).some(reference => (
        references.has(reference) || references.has(String(reference).split(".").at(-1))
      ))
    ));

    for (const transport of parentTransports) {
      const sheet = transport.sheet;
      if (sheet?.rendered) await renderApplication(sheet);
    }
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
