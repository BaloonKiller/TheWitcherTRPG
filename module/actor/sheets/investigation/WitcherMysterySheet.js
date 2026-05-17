import { WITCHER } from "../../../setup/config.js";
import { ItemDocument, WitcherActorSheetV2, renderDocumentSheet, sanitizeSheetRenderOptions } from "../../../setup/foundry-compat.js";

export default class WitcherMysterySheet extends WitcherActorSheetV2 {

  render(force, options = {}) {
    return super.render(force, sanitizeSheetRenderOptions(options));
  }

  static DEFAULT_OPTIONS = {
    position: {
      width: 1120,
      height: 600,
    },
    template: "systems/thewitchertrpg/templates/sheets/investigation/mystery-sheet.hbs",
  };

  getData() {
    let context = super.getData();

    const actorData = this.actor.toObject(false);
    context.system = actorData.system;

    context.clues = context.actor.getList("clue");
    context.obstacles = context.actor.getList("obstacle");

    context.isGM = game.user.isGM
    context.skills = WITCHER.skillMap

    return context;
  }


  activateListeners(html) {
    super.activateListeners(html);

    html.find(".add-item").on("click", this._onItemAdd.bind(this));
    html.find(".item-edit").on("click", this._onItemEdit.bind(this));
    html.find(".item-delete").on("click", this._onItemDelete.bind(this));
    html.find(".item-hide").on("click", this._onItemHide.bind(this));

    html.find(".inline-edit").change(this._onInlineEdit.bind(this));
  }

  async _onItemAdd(event) {
    let element = event.currentTarget
    let itemData = {
      name: `new ${element.dataset.itemtype}`,
      type: element.dataset.itemtype
    }

    await ItemDocument.create(itemData, { parent: this.actor })
  }


  async _onItemEdit(event) {
    event.preventDefault();
    let itemId = event.currentTarget.closest(".item").dataset.itemId;
    let item = this.actor.items.get(itemId);

    await renderDocumentSheet(item)
  }

  async _onItemDelete(event) {
    event.preventDefault();
    let itemId = event.currentTarget.closest(".item").dataset.itemId;
    return await this.actor.items.get(itemId).delete();
  }

  async _onItemHide(event) {
    event.preventDefault();
    let itemId = event.currentTarget.closest(".item").dataset.itemId;
    let item = this.actor.items.get(itemId);
    if (item) await item.update({ "system.isHidden": !item.system.isHidden })
  }

  _onInlineEdit(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = element.closest(".item").dataset.itemId;
    let item = this.actor.items.get(itemId);
    let field = element.dataset.field;
    // Edit checkbox values
    let value = element.value
    if (value == "false") {
      value = true
    }
    if (value == "true" || value == "checked") {
      value = false
    }

    return item.update({ [field]: value });
  }
}
