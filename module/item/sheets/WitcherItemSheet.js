
import { genId } from "../../scripts/witcher.js";
import { DragDrop, WitcherItemSheetV2, deepClone } from "../../setup/foundry-compat.js";

export default class WitcherItemSheet extends WitcherItemSheetV2 {
  /** @override */
  static DEFAULT_OPTIONS = {
    position: {
      width: 520,
      height: 480,
    },
  };

  get template() {
    return `systems/thewitchertrpg/templates/sheets/${this.object.type}-sheet.hbs`;
  }

  /** @override */
  getData() {
    const data = super.getData();
    data.config = CONFIG.WITCHER;

    data.data = data.item?.system
    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);
    this.element.classList.add(`item-${this.item.type}`);

    html.find(".add-effect").on("click", this._onAddEffect.bind(this));
    html.find(".add-modifier-stat").on("click", this._onAddModifierStat.bind(this));
    html.find(".add-modifier-skill").on("click", this._onAddModifierSkill.bind(this));
    html.find(".add-modifier-derived").on("click", this._onAddModifierDerived.bind(this));

    html.find(".add-component").on("click", this._onAddComponent.bind(this));
    html.find(".add-associated-item").on("click", this._onAddAssociatedItem.bind(this))
    html.find(".remove-associated-item").on("click", this._onRemoveAssociatedItem.bind(this))
    html.find(".remove-component").on("click", this._onRemoveComponent.bind(this));

    html.find(".remove-effect").on("click", this._oRemoveEffect.bind(this));
    html.find(".remove-modifier-stat").on("click", this._onRemoveModifierStat.bind(this));
    html.find(".remove-modifier-skill").on("click", this._onRemoveModifierSkill.bind(this));
    html.find(".remove-modifier-derived").on("click", this._onRemoveModifierDerived.bind(this));

    html.find(".list-edit").on("blur", this._onEffectEdit.bind(this));
    html.find(".modifiers-edit").on("change", this._onModifierEdit.bind(this));
    html.find(".modifiers-edit-skills").on("change", this._onModifierSkillsEdit.bind(this));
    html.find(".modifiers-edit-derived").on("change", this._onModifierDerivedEdit.bind(this));
    html.find("input").focusin(ev => this._onFocusIn(ev));
    html.find(".damage-type").on("change", this._onDamageTypeEdit.bind(this));
    html.find(".dragable").on("dragstart", (ev) => {
      let itemId = ev.target.dataset.id
      let item = this.actor.items.get(itemId);
      ev.originalEvent.dataTransfer.setData(
        "text/plain",
        JSON.stringify(item.toDragData()),
      )
    });

    const newDragDrop = new DragDrop({
      dragSelector: `.dragable`,
      dropSelector: `.window-content`,
      permissions: { dragstart: this._canDragStart.bind(this), drop: this._canDragDrop.bind(this) },
      callbacks: { dragstart: this._onDragStart.bind(this), drop: this._onDrop.bind(this) }
    })
    newDragDrop.bind(this.element);
    this._witcherDragDrop = newDragDrop;
  }

  async _onEffectEdit(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = element.closest(".list-item").dataset.id;

    let field = element.dataset.field;
    let value = element.value

    let effects = deepClone(this.item.system.effects ?? [])
    let objIndex = effects.findIndex((obj => obj.id == itemId));
    if (objIndex < 0) return;
    effects[objIndex][field] = value

    await this.item.update({ 'system.effects': effects });
    
  }

  async _onModifierEdit(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = element.closest(".list-item").dataset.id;
    let field = element.dataset.field;
    let value = element.value
    let effects = deepClone(this.item.system.stats ?? [])
    let objIndex = effects.findIndex((obj => obj.id == itemId));
    if (objIndex < 0) return;
    effects[objIndex][field] = value
    await this.item.update({ 'system.stats': effects });
  }

  async _onDamageTypeEdit(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let newval = Object.assign({}, this.item.system.type)
    newval[element.id] = !newval[element.id]
    let types = []
    if (newval.slashing) types.push(game.i18n.localize("WITCHER.Armor.slashing"))
    if (newval.piercing) types.push(game.i18n.localize("WITCHER.Armor.piercing"))
    if (newval.bludgeoning) types.push(game.i18n.localize("WITCHER.Armor.bludgeoning"))
    if (newval.elemental) types.push(game.i18n.localize("WITCHER.Armor.elemental"))
    newval.text = types.join(", ")
    await this.item.update({ 'system.type': newval });
  }

  async _onModifierDerivedEdit(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = element.closest(".list-item").dataset.id;

    let field = element.dataset.field;
    let value = element.value
    let effects = deepClone(this.item.system.derived ?? [])
    let objIndex = effects.findIndex((obj => obj.id == itemId));
    if (objIndex < 0) return;
    effects[objIndex][field] = value
    await this.item.update({ 'system.derived': effects });
  }

  async _onModifierSkillsEdit(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = element.closest(".list-item").dataset.id;

    let field = element.dataset.field;
    let value = element.value
    let effects = deepClone(this.item.system.skills ?? [])
    let objIndex = effects.findIndex((obj => obj.id == itemId));
    if (objIndex < 0) return;
    effects[objIndex][field] = value
    await this.item.update({ 'system.skills': effects });
  }

  async _onRemoveComponent(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = element.closest(".list-item").dataset.id;
    let newComponentList = this.item.system.craftingComponents.filter(item => item.id !== itemId)
    await this.item.update({ 'system.craftingComponents': newComponentList });
  }

  async _oRemoveEffect(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = element.closest(".list-item").dataset.id;
    let newEffectList = this.item.system.effects.filter(item => item.id !== itemId)
    await this.item.update({ 'system.effects': newEffectList });
  }

  async _onRemoveModifierStat(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = element.closest(".list-item").dataset.id;
    let newModifierList = this.item.system.stats.filter(item => item.id !== itemId)
    await this.item.update({ 'system.stats': newModifierList });
  }

  async _onRemoveModifierSkill(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = element.closest(".list-item").dataset.id;
    let newModifierList = this.item.system.skills.filter(item => item.id !== itemId)
    await this.item.update({ 'system.skills': newModifierList });
  }

  async _onRemoveModifierDerived(event) {
    event.preventDefault();
    let element = event.currentTarget;
    let itemId = element.closest(".list-item").dataset.id;
    let newModifierList = this.item.system.derived.filter(item => item.id !== itemId)
    await this.item.update({ 'system.derived': newModifierList });
  }

  async _onAddEffect(event) {
    event.preventDefault();
    let newEffectList = []
    if (this.item.system.effects) {
      newEffectList = deepClone(this.item.system.effects)
    }
    newEffectList.push({ id: genId(), name: "effect", percentage: "", durationRounds: 0 })
    await this.item.update({ 'system.effects': newEffectList });
  }

  async _onAddComponent(event) {
    event.preventDefault();
    let newComponentList = []
    if (this.item.system.craftingComponents) {
      newComponentList = deepClone(this.item.system.craftingComponents)
    }
    newComponentList.push({ id: genId(), name: "component", quantity: "" })
    await this.item.update({ 'system.craftingComponents': newComponentList });
  }

  async _onAddAssociatedItem(event) {
    //todo implement
  }

  async _onRemoveAssociatedItem(event) {
    event.preventDefault();
  }

  async _onAddModifierStat(event) {
    event.preventDefault();
    let newModifierList = []
    if (this.item.system.stats) {
      newModifierList = deepClone(this.item.system.stats)
    }
    newModifierList.push({ id: genId(), stat: "none", modifier: 0 })
    await this.item.update({ 'system.stats': newModifierList });
  }

  async _onAddModifierSkill(event) {
    event.preventDefault();
    let newModifierList = []
    if (this.item.system.skills) {
      newModifierList = deepClone(this.item.system.skills)
    }
    newModifierList.push({ id: genId(), skill: "none", modifier: 0 })
    await this.item.update({ 'system.skills': newModifierList });
  }

  async _onAddModifierDerived(event) {
    event.preventDefault();
    let newModifierList = []
    if (this.item.system.derived) {
      newModifierList = deepClone(this.item.system.derived)
    }
    newModifierList.push({ id: genId(), derivedStat: "none", modifier: 0 })
    await this.item.update({ 'system.derived': newModifierList });
  }

  _onFocusIn(event) {
    event.currentTarget.select();
  }
}
