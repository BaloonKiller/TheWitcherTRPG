import { WITCHER } from "../../../setup/config.js";
import { ItemSheetV1, mergeObject } from "../../../setup/foundry-compat.js";

export default class WitcherObstacleSheet extends ItemSheetV1 {
  /** @override */
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["witcher", "sheet", "item"],
      width: 520,
      height: 480,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "description" }],
      dragDrop: [{
        dragSelector: ".items-list .item",
        dropSelector: null
      }],
    });
  }

  get template() {
    return `systems/thewitchertrpg/templates/sheets/investigation/obstacle-sheet.hbs`;
  }

  /** @override */
  getData() {
    const data = super.getData();

    data.skills = WITCHER.skillMap

    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

   
  }
}
