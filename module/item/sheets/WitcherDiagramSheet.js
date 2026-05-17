
import { genId } from "../../scripts/witcher.js";
import { TextEditor, deepClone, fromUuid } from "../../setup/foundry-compat.js";
import WitcherItemSheet from "./WitcherItemSheet.js";

export default class WitcherDiagramSheet extends WitcherItemSheet {

  get template() {
    return `systems/thewitchertrpg/templates/sheets/diagrams-sheet.hbs`;
  }

  /** @override */
  getData() {
    const data = super.getData();
    return data;
  }

  async _onDrop(event) {
    const dragEventData = TextEditor.getDragEventData(event)
    const item = await fromUuid(dragEventData.uuid)

    if (item) {
      if (event.target.closest?.('[data-type="associatedItem"]')) {
        await this.item.update({ 'system.associatedItemUuid': item.uuid });
      } else {
        const newComponentList = deepClone(this.item.system.craftingComponents ?? [])
        newComponentList.push({ id: genId(), name: item.name, quantity: 1 })
        await this.item.update({ 'system.craftingComponents': newComponentList });
      }
    }
  }

  async _onEffectEdit(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = element.closest(".list-item").dataset.id;

    let field = element.dataset.field;
    let value = element.value
    
    let components = deepClone(this.item.system.craftingComponents)
    let objIndex = components.findIndex((obj => obj.id == itemId));
    if (objIndex < 0) return;
    components[objIndex][field] = value
    await this.item.update({ 'system.craftingComponents': components });
  }

  async _onAddAssociatedItem(event) {
    event.preventDefault();
    ui.notifications.info(game.i18n.localize("WITCHER.craft.DropAssociatedItem"));
  }

  async _onRemoveAssociatedItem(event) {
    event.preventDefault();
    await this.item.update({ 'system.associatedItemUuid': "" });
  }

}
