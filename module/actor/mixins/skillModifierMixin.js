import { genId } from "../../scripts/witcher.js";

export let skillModifierMixin = {
  async _onAddSkillModifier(event) {
    let stat = event.currentTarget.closest(".skill").dataset.stat;
    let skill = event.currentTarget.closest(".skill").dataset.skill;
    let newModifierList = []
    if (this.actor.system.skills[stat][skill].modifiers) {
      newModifierList = foundry.utils.deepClone(this.actor.system.skills[stat][skill].modifiers)
    }
    newModifierList.push({ id: genId(), name: "Modifier", value: 0 })

    await this.actor.update({ [`system.skills.${this.skillMap[skill].attribute.name}.${skill}.modifiers`]: newModifierList });
  },

  async _onSkillModifierDisplay(event) {
    event.preventDefault();
    let skill = event.currentTarget.closest(".skill").dataset.skill;

    await this.actor.update({ [`system.skills.${this.skillMap[skill].attribute.name}.${skill}.isOpened`]: !this.actor.system.skills[this.skillMap[skill].attribute.name][skill].isOpened });
  },

  async _onSkillModifierRemove(event) {
    let stat = event.currentTarget.closest(".skill").dataset.stat;
    let skill = event.currentTarget.closest(".skill").dataset.skill;

    let prevModList = this.actor.system.skills[stat][skill].modifiers;
    const newModList = Object.values(prevModList).map((details) => details);
    const idxToRm = newModList.findIndex((v) => v.id === event.target.dataset.id);
    if (idxToRm < 0) return;
    newModList.splice(idxToRm, 1);

    await this.actor.update({ [`system.skills.${this.skillMap[skill].attribute.name}.${skill}.modifiers`]: newModList });
  },

  async _onSkillModifierEdit(event) {
    let stat = event.currentTarget.closest(".skill").dataset.stat;
    let skill = event.currentTarget.closest(".skill").dataset.skill;

    let element = event.currentTarget;
    let itemId = element.closest(".list-modifiers").dataset.id;

    let field = element.dataset.field;
    let value = element.value
    let modifiers = foundry.utils.deepClone(this.actor.system.skills[stat][skill].modifiers ?? []);

    let objIndex = modifiers.findIndex((obj => obj.id == itemId));
    if (objIndex < 0) return;
    modifiers[objIndex][field] = value

    await this.actor.update({ [`system.skills.${this.skillMap[skill].attribute.name}.${skill}.modifiers`]: modifiers });
  },


  skillModifierListener(html) {
    html.find(".add-skill-modifier").on("click", this._onAddSkillModifier.bind(this));
    html.find(".skill-modifier-display").on("click", this._onSkillModifierDisplay.bind(this));
    html.find(".skill-mod-edit").on("blur", this._onSkillModifierEdit.bind(this));
    html.find(".delete-skill-modifier").on("click", this._onSkillModifierRemove.bind(this));



  }

}
