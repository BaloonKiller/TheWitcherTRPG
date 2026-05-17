import { ItemDocument } from "../../setup/foundry-compat.js";

export let activeEffectMixin = {

  async _onAddActiveEffect() {
    let itemData = {
      name: `new effect`,
      type: "effect"
    }
    await ItemDocument.create(itemData, { parent: this.actor })
  },

  activeEffectListener(html) {
    html.find(".add-active-effect").on("click", this._onAddActiveEffect.bind(this));
  }

}
