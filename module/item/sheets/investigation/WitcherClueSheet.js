import { WITCHER } from "../../../setup/config.js";
import { WitcherItemSheetV2 } from "../../../setup/foundry-compat.js";

export default class WitcherClueSheet extends WitcherItemSheetV2 {
  /** @override */
  static DEFAULT_OPTIONS = {
    position: {
      width: 520,
      height: 480,
    },
  };

  get template() {
    return `systems/thewitchertrpg/templates/sheets/investigation/clue-sheet.hbs`;
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
