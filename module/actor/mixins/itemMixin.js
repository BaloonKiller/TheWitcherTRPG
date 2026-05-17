import { buttonDialog, extendedRoll } from "../../scripts/chat.js";
import { rollDamage } from "../../scripts/attack.js";
import { addModifiers, sumItemProperty } from "../../scripts/witcher.js";
import { addActorSkillEffectModifiers } from "../../scripts/actorSkillEffects.mjs";
import { RollConfig } from "../../scripts/rollConfig.js";
import {
  DragDrop,
  ItemDocument,
  WitcherDialog,
  deepClone,
  fromUuidSync,
  renderDocumentSheet,
  renderTemplate,
  renderApplication,
} from "../../setup/foundry-compat.js";
import { depositCurrencyItem } from "../../scripts/currencyLedger.js";
import {
  getEffectiveSpellDefence,
  getSpellDamageFormulaDisplay,
  hasSpellDefenceRoll,
} from "../../scripts/spellResolution.mjs";
import { createSpellAreaResolution, renderSpellAreaResolution } from "../../scripts/spellArea.mjs";
import { endResolvedSpellArea } from "../../scripts/spellAreaEffects.mjs";
import {
  applySpellShieldBuff,
  canApplySpellShieldBuff,
  getSpellShieldDefinition,
} from "../../scripts/spellBuffs.mjs";
import { findStackableInventoryItem, getItemDropSource } from "../../scripts/inventoryDrops.mjs";
import { buildTransportDocumentUpdate } from "../../scripts/documentUpdates.mjs";
import {
  isContainerItem,
  moveContainerBetweenActors,
  prepareContainerItemSource,
} from "../../scripts/containerStorage.mjs";

export let itemMixin = {

  async _onDropItem(event, item) {
    if (!this.actor.isOwner) return false;
    if (!item) return false;
    const itemData = item.toObject();
    const dropSource = getItemDropSource(item, this.actor);

    // Handle item sorting within the same Actor
    if (dropSource === "sameActor") return this._onSortItem(event, item);

    if (this._isUniqueItem(itemData)) {
      await this._removeItemsOfType(itemData.type)
    }

    // Compendium and world Items are templates, so copy them directly to the Actor.
    // Their standard Foundry drag data does not need to be parsed a second time.
    if (dropSource === "external") {
      return this._addItem(this.actor, item, 1, false, { isTransfer: true });
    }

    let previousActor = item.parent;
    if (!previousActor || previousActor.documentName !== "Actor") {
      return ui.notifications.error(game.i18n.localize("WITCHER.Items.InvalidSource"));
    }
    const token = previousActor.token ?? previousActor.getActiveTokens()[0];
    if (token) previousActor = token.actor;

    const sourceItem = previousActor.items.get(item.id) ?? item;
    if (isContainerItem(sourceItem)) {
      return moveContainerBetweenActors(sourceItem, this.actor, fromUuidSync);
    }

    const dragData = { item: sourceItem };

    // Calculate the rollable amount of items to be dropped from actors' inventory
    if (typeof (dragData.item.system.quantity) === 'string' && dragData.item.system.quantity.includes("d")) {
        let messageData = {
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          flavor: `<h1>Quantity of ${dragData.item.name}</h1>`,
        }
        let roll = await new Roll(dragData.item.system.quantity).evaluate()
        await roll.toMessage(messageData)

        // Add items to the recipient actor
        const rolledQuantity = Math.max(0, Math.floor(Number(roll.total)));
        if (rolledQuantity > 0) {
          const added = await this._addItem(this.actor, dragData.item, rolledQuantity, false, { isTransfer: true })
          if (!added) return;
        }

        // Remove items from donor actor
        if (previousActor) {
          const sourceItem = previousActor.items.get(dragData.item.id ?? dragData.item._id);
          if (sourceItem?.type === "diagrams" && sourceItem.system.learned) {
            await sourceItem.update({ "system.quantity": 0 });
          } else {
            await sourceItem?.delete();
          }
        }
      return
    }

    if (dragData.item.system.quantity != 0) {
      if (dragData.item.system.quantity > 1) {
          let content = `${game.i18n.localize("WITCHER.Items.transferMany")}: <input type="number" class="small" name="numberOfItem" min="1" max="${dragData.item.system.quantity}" value="1">/${dragData.item.system.quantity} <br />`
          let cancel = true
          let numberOfItem = 0
          let dialogData = {
            buttons: [
              [`${game.i18n.localize("WITCHER.Button.Continue")}`, (html) => {
                numberOfItem = html.find("[name=numberOfItem]")[0].value;
                cancel = false
              }],
              [`${game.i18n.localize("WITCHER.Button.All")}`, () => {
                numberOfItem = dragData.item.system.quantity
                cancel = false
              }]
            ],
            title: game.i18n.localize("WITCHER.Items.transferTitle"),
            content: content
          }
          await buttonDialog(dialogData)

          if (cancel) {
            return
          } else {
            numberOfItem = getValidItemQuantity(numberOfItem, dragData.item.system.quantity)
            if (!numberOfItem) return;

            // Add items to the recipient actor
            const added = await this._addItem(this.actor, dragData.item, numberOfItem, false, { isTransfer: true })
            if (!added) return;
            // Remove items from donor actor
            await this._removeItem(previousActor, dragData.item.id ?? dragData.item._id, numberOfItem)
          }
      } else {
          // Add item to the recipient actor
          const added = await this._addItem(this.actor, dragData.item, 1, false, { isTransfer: true })
          if (!added) return;
          // Remove item from donor actor
          if (previousActor) {
            await this._removeItem(previousActor, dragData.item.id ?? dragData.item._id, 1)
          }
      }
    }
  },

  _isUniqueItem(itemData) {
    return false;
  },

  async _removeItemsOfType(type) {
    let actor = this.actor;
    return actor.deleteEmbeddedDocuments("Item", actor.items.filter(item => item.type === type).map(item => item.id))
  },

  async _removeItem(actor, itemId, quantityToRemove) {
    if (!actor?.items?.get(itemId)) return false;
    const quantity = getValidItemQuantity(quantityToRemove, actor.items.get(itemId).system.quantity);
    if (!quantity) return false;
    await actor.removeItem(itemId, quantity)
    return true;
  },

  async _addItem(actor, Additem, numberOfItem, forcecreate = false, options = {}) {
    const currencyDeposit = await depositCurrencyItem(
      actor,
      Additem,
      numberOfItem,
      `${game.i18n.localize("WITCHER.CurrencyLedger.TransferredItem")} ${Additem.name}`,
    );
    if (currencyDeposit) return currencyDeposit.deposited;

    const isTransport = Additem.type === "mount";
    const isContainer = isContainerItem(Additem);
    const isUniqueStorage = isTransport || isContainer;
    let foundItem = isUniqueStorage ? null : findStackableInventoryItem(actor.items, Additem);
    if (foundItem && !forcecreate) {
      await foundItem.update({ 'system.quantity': Number(foundItem.system.quantity) + Number(numberOfItem) })
    }
    else {
      let newItem = deepClone(Additem.toObject?.() ?? Additem);
      if (isContainer) newItem = prepareContainerItemSource(newItem);

      if (numberOfItem) {
        newItem.system.quantity = isUniqueStorage ? 1 : Number(numberOfItem)
      }
      if (isTransport && options.isTransfer) {
        newItem.system.accessories = [];
        newItem.system.cargo = [];
        newItem.system.pullerId = "";
      }
      if (isContainer && options.isTransfer) {
        newItem.system.content = [];
        newItem.system.isStored = false;
      }
      if (options.isTransfer && newItem.type === "diagrams") {
        newItem.system.learned = false;
      }
      await actor.createEmbeddedDocuments("Item", [newItem]);
    }
    return true;
  },

  async _onItemAdd(event) {
    let element = event.currentTarget
    let itemData = {
      name: `new ${element.dataset.itemtype}`,
      type: element.dataset.itemtype
    }

    switch (element.dataset.spelltype) {
      case "spellNovice":
        itemData.system = { class: "Spells", level: "novice" }
        break;
      case "spellJourneyman":
        itemData.system = { class: "Spells", level: "journeyman" }
        break;
      case "spellMaster":
        itemData.system = { class: "Spells", level: "master" }
        break;
      case "rituals":
        itemData.system = { class: "Rituals" }
        break;
      case "hexes":
        itemData.system = { class: "Hexes" }
        break;
      case "magicalgift":
        itemData.system = { class: "MagicalGift" }
        break;
    }

    if (element.dataset.itemtype == "component") {
      if (element.dataset.subtype == "alchemical") {
        itemData.system = { type: element.dataset.subtype }
      } else if (element.dataset.subtype) {
        itemData.system = { type: "substances", substanceType: element.dataset.subtype }
      } else {
        itemData.system = { type: "component", substanceType: element.dataset.subtype }
      }
    }

    if (element.dataset.itemtype == "valuable") {
      itemData.system = { type: "general" };
    }

    if (element.dataset.itemtype == "diagram") {
      itemData.system = { type: "alchemical", level: "novice", isFormulae: true };
    }

    await ItemDocument.create(itemData, { parent: this.actor })
  },

  async _onSpellRoll(event, itemId = null) {

    let displayRollDetails = game.settings.get("thewitchertrpg", "displayRollsDetails")

    if (!itemId) {
      itemId = event.currentTarget.closest(".item").dataset.itemId;
    }
    let spellItem = this.actor.items.get(itemId);
    const spellShieldDefinition = getSpellShieldDefinition(spellItem);
    const shieldAvailability = canApplySpellShieldBuff(this.actor, spellShieldDefinition);
    if (spellShieldDefinition && !shieldAvailability.allowed) {
      return ui.notifications.warn(game.i18n.format("WITCHER.SpellBuff.ShieldAlreadyActive", {
        spell: shieldAvailability.lifecycle?.spellName ?? spellItem.name,
      }));
    }
    let rollFormula = `1d10`
    let spellSkill = null;
    let spellEffectSkill = null;
    rollFormula += !displayRollDetails ? `+${this.actor.system.stats.will.current}` : `+${this.actor.system.stats.will.current}[${game.i18n.localize("WITCHER.StWill")}]`;
    switch (spellItem.system.class) {
      case "Witcher":
      case "Invocations":
      case "Spells":
        spellSkill = this.actor.system.skills.will.spellcast;
        spellEffectSkill = "WITCHER.SkWillSpellcastLable";
        rollFormula += !displayRollDetails ? `+${spellSkill.value}` : `+${spellSkill.value}[${game.i18n.localize("WITCHER.SkWillSpellcastLable")}]`;
        break;
      case "Rituals":
        spellSkill = this.actor.system.skills.will.ritcraft;
        spellEffectSkill = "WITCHER.SkWillRitCraftLable";
        rollFormula += !displayRollDetails ? `+${spellSkill.value}` : `+${spellSkill.value}[${game.i18n.localize("WITCHER.SkWillRitCraftLable")}]`;
        break;
      case "Hexes":
        spellSkill = this.actor.system.skills.will.hexweave;
        spellEffectSkill = "WITCHER.SkWillHexLable";
        rollFormula += !displayRollDetails ? `+${spellSkill.value}` : `+${spellSkill.value}[${game.i18n.localize("WITCHER.SkWillHexLable")}]`;
        break;
    }

    let staCostTotal = spellItem.system.stamina;
    let customModifier = 0;
    let isExtraAttack = false

    let content = `<label>${game.i18n.localize("WITCHER.Dialog.attackExtra")}: <input type="checkbox" name="isExtraAttack"></label> <br />`
    if (spellItem.system.staminaIsVar) {
      content += `${game.i18n.localize("WITCHER.Spell.staminaDialog")}<input class="small" name="staCost" value=1> <br />`
    }

    let focusOptions = `<option value="0"> </option>`
    let secondFocusOptions = `<option value="0" selected> </option>`

    let useFocus = false
    if (this.actor.system.focus1.value > 0) {
      focusOptions += `<option value="${this.actor.system.focus1.value}" selected> ${this.actor.system.focus1.name} (${this.actor.system.focus1.value}) </option>`;
      secondFocusOptions += `<option value="${this.actor.system.focus1.value}"> ${this.actor.system.focus1.name} (${this.actor.system.focus1.value}) </option>`;
      useFocus = true
    }
    if (this.actor.system.focus2.value > 0) {
      focusOptions += `<option value="${this.actor.system.focus2.value}"> ${this.actor.system.focus2.name} (${this.actor.system.focus2.value}) </option>`;
      secondFocusOptions += `<option value="${this.actor.system.focus2.value}"> ${this.actor.system.focus2.name} (${this.actor.system.focus2.value}) </option>`;
      useFocus = true
    }
    if (this.actor.system.focus3.value > 0) {
      focusOptions += `<option value="${this.actor.system.focus3.value}"> ${this.actor.system.focus3.name} (${this.actor.system.focus3.value}) </option>`;
      secondFocusOptions += `<option value="${this.actor.system.focus3.value}"> ${this.actor.system.focus3.name} (${this.actor.system.focus3.value}) </option>`;
      useFocus = true
    }
    if (this.actor.system.focus4.value > 0) {
      focusOptions += `<option value="${this.actor.system.focus4.value}"> ${this.actor.system.focus4.name} (${this.actor.system.focus4.value}) </option>`;
      secondFocusOptions += `<option value="${this.actor.system.focus4.value}"> ${this.actor.system.focus4.name} (${this.actor.system.focus4.value}) </option>`;
      useFocus = true
    }

    if (useFocus) {
      content += ` <label>${game.i18n.localize("WITCHER.Spell.ChooseFocus")}: <select name="focus">${focusOptions}</select></label> <br />`
      content += ` <label>${game.i18n.localize("WITCHER.Spell.ChooseExpandedFocus")}: <select name="secondFocus">${secondFocusOptions}</select></label> <br />`
    }
    content += `<label>${game.i18n.localize("WITCHER.Dialog.attackCustom")}: <input class="small" name="customMod" value=0></label> <br /><br />`;
    let cancel = true
    let focusValue = 0
    let secondFocusValue = 0

    let dialogData = {
      buttons: [
        [`${game.i18n.localize("WITCHER.Button.Continue")}`, (html) => {
          if (spellItem.system.staminaIsVar) {
            staCostTotal = html.find("[name=staCost]")[0].value;
          }
          customModifier = html.find("[name=customMod]")[0].value;
          isExtraAttack = html.find("[name=isExtraAttack]").prop("checked");
          if (html.find("[name=focus]")[0]) {
            focusValue = html.find("[name=focus]")[0].value;
          }
          if (html.find("[name=secondFocus]")[0]) {
            secondFocusValue = html.find("[name=secondFocus]")[0].value;
          }
          cancel = false
        }]],
      title: game.i18n.localize("WITCHER.Spell.MagicCost"),
      content: content
    }

    await buttonDialog(dialogData)

    if (cancel) {
      return
    }
    let origStaCost = staCostTotal
    let newSta = this.actor.system.derivedStats.sta.value

    staCostTotal -= Number(focusValue) + Number(secondFocusValue)
    if (isExtraAttack) {
      staCostTotal += 3
    }

    let useMinimalStaCost = false
    if (staCostTotal < 1) {
      useMinimalStaCost = true
      staCostTotal = 1
    }

    newSta -= staCostTotal

    if (newSta < 0) {
      return ui.notifications.error(game.i18n.localize("WITCHER.Spell.notEnoughSta"));
    }

    const casterToken = this.actor.getControlledToken();
    let spellVisualEffect = null;
    let spellAreaTargets = [];
    if (spellItem.system.createTemplate) {
      try {
        spellVisualEffect = await spellItem.createSpellVisualEffectIfApplicable(casterToken, {
          staminaSpent: origStaCost,
        });
      } catch (error) {
        console.error("TheWitcherTRPG | Could not place the spell area.", error);
        ui.notifications.error(game.i18n.localize("WITCHER.SpellArea.PlacementFailed"));
        return;
      }
      if (spellVisualEffect?.cancelled) {
        ui.notifications.info(game.i18n.localize("WITCHER.SpellArea.Cancelled"));
        return;
      }

      const selectedTargets = await chooseSpellAreaTargets(spellItem, spellVisualEffect?.targets ?? []);
      if (selectedTargets === null) {
        await spellItem.removeSpellVisualEffect(spellVisualEffect);
        return;
      }
      spellAreaTargets = selectedTargets;
    }

    await this.actor.update({
      'system.derivedStats.sta.value': newSta
    });

    let staCostDisplay = `${origStaCost}[${game.i18n.localize("WITCHER.Spell.Short.StaCost")}]`

    if (isExtraAttack) {
      staCostDisplay += ` + 3[${game.i18n.localize("WITCHER.Dialog.attackExtra")}]`
    }

    staCostDisplay += ` - ${Number(focusValue) + Number(secondFocusValue)}[${game.i18n.localize("WITCHER.Actor.DerStat.Focus")}]`
    staCostDisplay += ` =  ${staCostTotal}`
    if (useMinimalStaCost) {
      staCostDisplay += `[${game.i18n.localize("WITCHER.MinValue")}]`
    }

    if (customModifier < 0) { rollFormula += !displayRollDetails ? `${customModifier}` : `${customModifier}[${game.i18n.localize("WITCHER.Settings.Custom")}]` }
    if (customModifier > 0) { rollFormula += !displayRollDetails ? `+${customModifier}` : `+${customModifier}[${game.i18n.localize("WITCHER.Settings.Custom")}]` }
    if (isExtraAttack) { rollFormula += !displayRollDetails ? `-3` : `-3[${game.i18n.localize("WITCHER.Dialog.attackExtra")}]` }
    rollFormula = addModifiers(spellSkill?.modifiers, rollFormula);
    rollFormula = addActorSkillEffectModifiers(this.actor, spellEffectSkill, rollFormula);

    let spellSource = ''
    switch (spellItem.system.source) {
      case "mixedElements": spellSource = "WITCHER.Spell.Mixed"; break;
      case "earth": spellSource = "WITCHER.Spell.Earth"; break;
      case "air": spellSource = "WITCHER.Spell.Air"; break;
      case "fire": spellSource = "WITCHER.Spell.Fire"; break;
      case "Water": spellSource = "WITCHER.Spell.Water"; break;
    }

    const spellDefence = getEffectiveSpellDefence(spellItem);
    const spellHasDefence = hasSpellDefenceRoll(spellDefence);
    const hasSpellArea = spellVisualEffect?.type === "Region" && Boolean(spellVisualEffect.document);
    const spellMessageClass = spellHasDefence ? "attack-message spell-attack-message" : "spell-message";
    const spellLocation = this.actor.getLocationObject("randomSpell");
    let spellDamage = null;

    let messageData = {
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flags: { thewitchertrpg: spellItem.getSpellFlags() },
      flavor: `<div class="${spellMessageClass}" data-location="${spellLocation.name}" data-defence="${escapeAttribute(spellDefence)}"><h2><img src="${spellItem.img}" class="item-img" />${spellItem.name}</h2>
            <div><b>${game.i18n.localize("WITCHER.Spell.StaCost")}: </b>${staCostDisplay}</div>
            <div><b>${game.i18n.localize("WITCHER.Mutagen.Source")}: </b>${game.i18n.localize(spellSource)}</div>
            <div><b>${game.i18n.localize("WITCHER.Spell.Effect")}: </b>${spellItem.system.effect}</div>`
    }
    if (spellItem.system.range) {
      messageData.flavor += `<div><b>${game.i18n.localize("WITCHER.Spell.Range")}: </b>${spellItem.system.range}</div>`
    }
    if (spellItem.system.duration) {
      messageData.flavor += `<div><b>${game.i18n.localize("WITCHER.Spell.Duration")}: </b>${spellItem.system.duration}</div>`
    }
    if (spellDefence) {
      messageData.flavor += `<div><b>${game.i18n.localize("WITCHER.Spell.Defence")}: </b>${spellDefence}</div>`
    }
    if (spellItem.system.preparationTime) {
      messageData.flavor += `<div><b>${game.i18n.localize("WITCHER.Spell.PrepTime")}: </b>${spellItem.system.preparationTime}</div>`
    }
    if (spellItem.system.difficultyCheck) {
      messageData.flavor += `<div><b>${game.i18n.localize("WITCHER.DC")}: </b>${spellItem.system.difficultyCheck}</div>`
    }
    if (spellItem.system.components) {
      messageData.flavor += `<div><b>${game.i18n.localize("WITCHER.Spell.Components")}: </b>${spellItem.system.components}</div>`
    }
    if (spellItem.system.alternateComponents) {
      messageData.flavor += `<div><b>${game.i18n.localize("WITCHER.Spell.AlternateComponents")}: </b>${spellItem.system.alternateComponents}</div>`
    }
    if (spellItem.system.liftRequirement) {
      messageData.flavor += `<div><b>${game.i18n.localize("WITCHER.Spell.Requirements")}: </b>${spellItem.system.liftRequirement}</div>`
    }

    if (spellItem.system.causeDamages) {
      let damageType = getSpellDamageType(spellItem)
      let ignoreArmor = getSpellIgnoresArmor(spellItem)

      let dmg = spellItem.system.damage || "0"
      if (spellItem.system.staminaIsVar) {
        dmg = this.calcStaminaMulti(origStaCost, dmg)
      }

      spellDamage = {
        formula: dmg,
        location: spellLocation,
        effects: deepClone(spellItem.system.effects ?? []),
        duration: spellItem.system.duration,
        type: damageType,
        ignoreArmor,
        applyEffectsOnHit: true,
      };

      const formulaDisplay = getSpellDamageFormulaDisplay(spellItem.system.damage, dmg, {
        isVariable: spellItem.system.staminaIsVar,
        staminaSpent: origStaCost,
      });
      const displayedFormula = formulaDisplay.scalesWithStamina
        ? game.i18n.format("WITCHER.Spell.VariableDamageFormula", {
          total: formulaDisplay.total,
          base: formulaDisplay.base,
          stamina: formulaDisplay.stamina,
        })
        : formulaDisplay.total;
      messageData.flavor += `<div class="spell-damage-formula"><b>${game.i18n.localize("WITCHER.table.Damage")}:</b> ${escapeAttribute(displayedFormula)}</div>`;

      if (!spellHasDefence && !hasSpellArea) {
        messageData.flavor += `<button class="damage">${game.i18n.localize("WITCHER.table.Damage")}</button>`;
      }
    }

    if (spellItem.system.doesHeal) {
      let heal = spellItem.system.heal || "0"
      if (spellItem.system.staminaIsVar) {
        heal = this.calcStaminaMulti(origStaCost, heal)
      }

      messageData.flavor += `<button class="heal" data-img="${spellItem.img}" data-name="${spellItem.name}" data-heal="${heal}" data-actor="${this.actor.uuid}">${game.i18n.localize("WITCHER.Spell.Short.Heal")}</button>`;
    }

    messageData.flavor += `</div>`;
    let config = new RollConfig()
    config.showCrit = true
    config.showResult = false
    const roll = await extendedRoll(rollFormula, messageData, config)
    const attackTotal = Number(roll.total);
    messageData.flavor = messageData.flavor.replace(
      `class="${spellMessageClass}"`,
      `class="${spellMessageClass}" data-attack-total="${attackTotal}"`,
    );
    messageData.flags.thewitchertrpg.attackTotal = attackTotal;
    messageData.flags.thewitchertrpg.attackLocation = spellLocation.name;
    if (spellDamage) messageData.flags.thewitchertrpg.damage = spellDamage;
    if (hasSpellArea) {
      const spellArea = createSpellAreaResolution({
        region: spellVisualEffect.document,
        casterToken,
        spell: spellItem,
        targets: spellAreaTargets,
        attackTotal,
        defence: spellDefence,
        hasDefence: spellHasDefence,
        hasDamage: Boolean(spellDamage),
      });
      messageData.flags.thewitchertrpg.spellArea = spellArea;
      messageData.flavor += renderSpellAreaResolution(spellArea, game.i18n);
    }
    const spellMessage = await roll.toMessage(messageData)
    if (spellShieldDefinition) {
      try {
        const shieldResult = await applySpellShieldBuff(this.actor, spellItem, {
          definition: spellShieldDefinition,
          staminaSpent: origStaCost,
        });
        if (!shieldResult.applied) {
          ui.notifications.error(game.i18n.localize("WITCHER.SpellBuff.ShieldApplicationFailed"));
        }
      } catch (error) {
        console.error("TheWitcherTRPG | Could not apply the spell shield buff.", error);
        ui.notifications.error(game.i18n.localize("WITCHER.SpellBuff.ShieldApplicationFailed"));
      }
    }
    if (hasSpellArea && spellMessage?.id) {
      await spellVisualEffect.document.update({
        "flags.thewitchertrpg.spellArea.messageId": spellMessage.id,
      }, { witcherSpellAreaEffect: true });
      await endResolvedSpellArea(spellMessage);
    }
    await spellItem.deleteSpellVisualEffect(spellVisualEffect);
  },

  async _onItemInlineEdit(event) {
    event.preventDefault();
    event.stopPropagation()
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

    if (item.type === "diagrams" && field === "system.quantity") {
      const quantity = Number(value);
      if (!Number.isFinite(quantity) || quantity < 0) {
        return ui.notifications.error(game.i18n.localize("WITCHER.Items.InvalidQuantity"));
      }
      value = Math.floor(quantity);
      if (value === 0 && !item.system.learned) return item.delete();
    }

    const updateData = { [field]: value };
    return item.update(item.type === "mount"
      ? buildTransportDocumentUpdate(updateData, item.system)
      : updateData);
  },

  _onItemEdit(event) {
    event.preventDefault();
    event.stopPropagation()
    let itemId = event.currentTarget.closest(".item").dataset.itemId;
    let item = this.actor.items.get(itemId);

    renderDocumentSheet(item)
  },

  async _onContainerContents(event) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item?.sheet) return false;

    if (typeof item.sheet.openContents === "function") {
      await item.sheet.openContents();
      return true;
    }
    await renderDocumentSheet(item);
    return true;
  },

  async _onItemShow(event) {
    event.preventDefault;
    event.stopPropagation()
    let itemId = event.currentTarget.closest(".item").dataset.itemId;
    let item = this.actor.items.get(itemId);

    renderApplication(new WitcherDialog({
      title: item.name,
      content: `<img src="${item.img}" alt="${item.img}" width="100%" />`,
      buttons: {}
    }, {
      width: 520,
      resizable: true
    }));
  },

  async _onItemDelete(event) {
    event.preventDefault();
    event.stopPropagation()
    let itemId = event.currentTarget.closest(".item").dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return false;

    if (item.type === "diagrams" && item.system.learned) {
      if (Number(item.system.quantity) > 0) {
        await item.update({ "system.quantity": 0 });
        return ui.notifications.info(game.i18n.localize("WITCHER.craft.PhysicalCopiesDiscarded"));
      }
      if (!await this._confirmRecipeForget(item)) return false;
    }

    return item.delete();
  },

  async _confirmRecipeForget(item) {
    let confirmed = false;
    await buttonDialog({
      title: game.i18n.localize("WITCHER.craft.ForgetRecipe"),
      content: game.i18n.format("WITCHER.craft.ForgetRecipeConfirm", { recipe: item.name }),
      buttons: [
        [game.i18n.localize("WITCHER.Button.Cancel"), () => {}],
        [game.i18n.localize("WITCHER.craft.ForgetRecipe"), () => { confirmed = true; }],
      ],
    });
    return confirmed;
  },

  async _chooseEnhancement(event) {
    let itemId = event.currentTarget.closest(".item").dataset.itemId;
    let item = this.actor.items.get(itemId)
    let type = event.currentTarget.closest(".item").dataset.type;

    let content = ""
    let enhancements = this.actor.getList("enhancement")
    if (type == "weapon") {
      enhancements = enhancements.filter(e => e.system.applied == false && (e.system.type == "rune" || e.system.type == "weapon"));
    } else {
      enhancements = enhancements.filter(e => e.system.applied == false && (e.system.type == "armor" || e.system.type == "glyph"));
    }

    let quantity = sumItemProperty(enhancements, "quantity")
    if (quantity == 0) {
      content += `<div class="error-display">${game.i18n.localize("WITCHER.Enhancement.NoEnhancement")}</div>`
    } else {
      let enhancementsOption = ``
      enhancements.forEach(element => {
        enhancementsOption += `<option value="${element.id}"> ${element.name}(${element.system.quantity}) </option>`;
      });
      content += `<div><label>${game.i18n.localize("WITCHER.Dialog.Enhancement")}: <select name="enhancement">${enhancementsOption}</select></label></div>`
    }

    renderApplication(new WitcherDialog({
      title: `${game.i18n.localize("WITCHER.Enhancement.ChooseTitle")}`,
      content,
      buttons: {
        Cancel: {
          label: `${game.i18n.localize("WITCHER.Button.Cancel")}`,
          callback: () => { }
        },
        Apply: {
          label: `${game.i18n.localize("WITCHER.Dialog.Apply")}`,
          callback: async (html) => {
            let enhancementId = undefined
            if (html.find("[name=enhancement]")[0]) {
              enhancementId = html.find("[name=enhancement]")[0].value;
            }
            let choosenEnhancement = this.actor.items.get(enhancementId)
            if (item && choosenEnhancement) {
              const enhancementItemIds = deepClone(item.system.enhancementItemIds ?? [])
                .filter(id => this.actor.items.has(id))
              if (enhancementItemIds.length >= Number(item.system.enhancements)) {
                return ui.notifications.error(game.i18n.localize("WITCHER.Enhancement.NoSlot"));
              }
              enhancementItemIds.push(choosenEnhancement.id)

              if (type == "weapon") {
                await item.update({ 'system.enhancementItemIds': enhancementItemIds })
              }
              else {
                let allEffects = deepClone(item.system.effects ?? [])
                allEffects.push(...choosenEnhancement.system.effects)
                if (choosenEnhancement.system.type == "armor" || choosenEnhancement.system.type == "glyph") {
                  await item.update({
                    'system.enhancementItemIds': enhancementItemIds,
                    "system.headStopping": item.system.headStopping + choosenEnhancement.system.stopping,
                    "system.headMaxStopping": item.system.headMaxStopping + choosenEnhancement.system.stopping,
                    "system.torsoStopping": item.system.torsoStopping + choosenEnhancement.system.stopping,
                    "system.torsoMaxStopping": item.system.torsoMaxStopping + choosenEnhancement.system.stopping,
                    "system.leftArmStopping": item.system.leftArmStopping + choosenEnhancement.system.stopping,
                    "system.leftArmMaxStopping": item.system.leftArmMaxStopping + choosenEnhancement.system.stopping,
                    "system.rightArmStopping": item.system.rightArmStopping + choosenEnhancement.system.stopping,
                    "system.rightArmMaxStopping": item.system.rightArmMaxStopping + choosenEnhancement.system.stopping,
                    "system.leftLegStopping": item.system.leftLegStopping + choosenEnhancement.system.stopping,
                    "system.leftLegMaxStopping": item.system.leftLegMaxStopping + choosenEnhancement.system.stopping,
                    "system.rightLegStopping": item.system.rightLegStopping + choosenEnhancement.system.stopping,
                    "system.rightLegMaxStopping": item.system.rightLegMaxStopping + choosenEnhancement.system.stopping,
                    'system.bludgeoning': choosenEnhancement.system.bludgeoning,
                    'system.slashing': choosenEnhancement.system.slashing,
                    'system.piercing': choosenEnhancement.system.piercing,
                    'system.effects': allEffects
                  })
                }
                else {
                  await item.update({
                    'system.enhancementItemIds': enhancementItemIds,
                    'system.effects': allEffects
                  })
                }
              }
              let newName = choosenEnhancement.name + "(Applied)"
              let newQuantity = Number(choosenEnhancement.system.quantity)
              if (newQuantity > 1) {
                const remainingEnhancements = deepClone(choosenEnhancement.toObject())
                remainingEnhancements.system.applied = false
                await this._addItem(this.actor, remainingEnhancements, newQuantity - 1, true)
              }
              await choosenEnhancement.update({
                'name': newName,
                'system.applied': true,
                'system.quantity': 1
              })
            }
          }
        }
      }
    }))
  },

  _onItemDisplayInfo(event) {
    event.preventDefault();
    event.stopPropagation()
    let section = event.currentTarget.closest(".item");
    let editor = $(section).find(".item-info")
    editor.toggleClass("invisible");
  },

  async _onItemRoll(event, itemId = null) {
    let displayRollDetails = game.settings.get("thewitchertrpg", "displayRollsDetails")

    if (!itemId) {
      itemId = event.currentTarget.closest(".item").dataset.itemId;
    }
    let item = this.actor.items.get(itemId);
    let displayDmgFormula = `${item.system.damage}`
    let formula = !displayRollDetails ? `${item.system.damage}` : `${item.system.damage}[${game.i18n.localize("WITCHER.Diagram.Weapon")}]`

    let isMeleeAttack = item.doesWeaponNeedMeleeSkillToAttack();
    if (this.actor.type == "character" && isMeleeAttack) {
      if (this.actor.system.attackStats.meleeBonus < 0) {
        displayDmgFormula += `${this.actor.system.attackStats.meleeBonus}`
        formula += !displayRollDetails ? `${this.actor.system.attackStats.meleeBonus}` : `${this.actor.system.attackStats.meleeBonus}[${game.i18n.localize("WITCHER.Dialog.attackMeleeBonus")}]`
      }
      if (this.actor.system.attackStats.meleeBonus > 0) {
        displayDmgFormula += `+${this.actor.system.attackStats.meleeBonus}`
        formula += !displayRollDetails ? `+${this.actor.system.attackStats.meleeBonus}` : `+${this.actor.system.attackStats.meleeBonus}[${game.i18n.localize("WITCHER.Dialog.attackMeleeBonus")}]`
      }
    }

    let attackSkill = item.getItemAttackSkill();
    let messageData = {
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: `<h1> ${game.i18n.localize("WITCHER.Dialog.attack")}: ${item.name}</h1>`,
    }

    let ammunitions = ``
    let noAmmo = 0
    let ammunitionOption = ``
    if (item.system.usingAmmo) {
      ammunitions = this.actor.items.filter(function (item) {
        return item.type == "weapon" && item.system.isAmmo && Number(item.system.quantity) > 0;
      });
      let quantity = sumItemProperty(ammunitions, "quantity")
      if (quantity <= 0) {
        noAmmo = 1;
      } else {
        ammunitions.forEach(element => {
          ammunitionOption += `<option value="${element.id}"> ${element.name}(${element.system.quantity}) </option>`;
        });
      }
    }

    let noThrowable = !this.actor.isEnoughThrowableWeapon(item)
    let meleeBonus = this.actor.system.attackStats.meleeBonus
    let data = { item, attackSkill, displayDmgFormula, isMeleeAttack, noAmmo, noThrowable, ammunitionOption, ammunitions, meleeBonus: meleeBonus }
    const myDialogOptions = { width: 500 }
    const dialogTemplate = await renderTemplate("systems/thewitchertrpg/templates/sheets/weapon-attack.hbs", data)

    renderApplication(new WitcherDialog({
      title: `${game.i18n.localize("WITCHER.Dialog.attackWith")}: ${item.name}`,
      content: dialogTemplate,
      buttons: {
        Roll: {
          label: `${game.i18n.localize("WITCHER.Dialog.ButtonRoll")}`,
          callback: async html => {
            let isExtraAttack = html.find("[name=isExtraAttack]").prop("checked");

            let location = html.find("[name=location]")[0].value;
            let ammunition = undefined
            if (html.find("[name=ammunition]")[0]) {
              ammunition = html.find("[name=ammunition]")[0].value;
            }

            let targetOutsideLOS = html.find("[name=targetOutsideLOS]").prop("checked");
            let outsideLOS = html.find("[name=outsideLOS]").prop("checked");
            let isFastDraw = html.find("[name=isFastDraw]").prop("checked");
            let isProne = html.find("[name=isProne]").prop("checked");
            let isPinned = html.find("[name=isPinned]").prop("checked");
            let isActivelyDodging = html.find("[name=isActivelyDodging]").prop("checked");
            let isMoving = html.find("[name=isMoving]").prop("checked");
            let isAmbush = html.find("[name=isAmbush]").prop("checked");
            let isRicochet = html.find("[name=isRicochet]").prop("checked");
            let isBlinded = html.find("[name=isBlinded]").prop("checked");
            let isSilhouetted = html.find("[name=isSilhouetted]").prop("checked");
            let customAim = html.find("[name=customAim]")[0].value;

            let range = item.system.range ? html.find("[name=range]")[0].value : null;
            let customAtt = html.find("[name=customAtt]")[0].value;
            let strike = html.find("[name=strike]")[0].value;
            let damageType = html.find("[name=damageType]")[0].value;
            let customDmg = html.find("[name=customDmg]")[0].value;
            let attacknumber = 1;

            let damage = {
              strike: strike,
              type: damageType
            };
            if (strike == "fast") {
              attacknumber = 2;
            }

            const ammunitionItem = ammunition ? this.actor.items.get(ammunition) : null;
            if (ammunition && (!ammunitionItem || Number(ammunitionItem.system.quantity) < attacknumber)) {
              return ui.notifications.error(game.i18n.localize("WITCHER.Dialog.NoAmmunition"));
            }
            if (item.isWeaponThrowable() && Number(item.system.quantity) < attacknumber) {
              return ui.notifications.error(game.i18n.localize("WITCHER.Dialog.NoThrowable"));
            }

            if (isExtraAttack) {
              let newSta = this.actor.system.derivedStats.sta.value - 3

              if (newSta < 0) {
                return ui.notifications.error(game.i18n.localize("WITCHER.Spell.notEnoughSta"));
              }
              await this.actor.update({
                'system.derivedStats.sta.value': newSta
              });
            }

            let allEffects = foundry.utils.deepClone(item.system.effects)
            if (ammunition) {
              const newQuantity = Number(ammunitionItem?.system.quantity) - attacknumber;
              await ammunitionItem.update({ "system.quantity": newQuantity })
              allEffects.push(...ammunitionItem.system.effects)
              damage.ammunition = ammunitionItem;
            }

            if (item.isWeaponThrowable()) {
              let newQuantity = Number(item.system.quantity) - attacknumber;
              await item.update({ "system.quantity": newQuantity })
              allEffects.push(...item.system.effects)
            }

            if (item.system.enhancementItems) {
              item.system.enhancementItems.forEach(element => {
                if (element && JSON.stringify(element) != '{}') {
                  let enhancement = this.actor.items.get(element.id);
                  allEffects.push(...enhancement.system.effects)
                }
              });
            }
            damage.effects = allEffects;

            for (let i = 0; i < attacknumber; i++) {
              let attFormula = "1d10"
              let damageFormula = formula;

              if (item.system.accuracy < 0) {
                attFormula += !displayRollDetails ? `${item.system.accuracy}` :
                  `${item.system.accuracy}[${game.i18n.localize("WITCHER.Weapon.Short.WeaponAccuracy")}]`
              }
              if (item.system.accuracy > 0) {
                attFormula += !displayRollDetails ? `+${item.system.accuracy}` :
                  `+${item.system.accuracy}[${game.i18n.localize("WITCHER.Weapon.Short.WeaponAccuracy")}]`
              }
              if (targetOutsideLOS) {
                attFormula += !displayRollDetails ? `-3` :
                  `-3[${game.i18n.localize("WITCHER.Dialog.attackTargetOutsideLOS")}]`;
              }
              if (outsideLOS) {
                attFormula += !displayRollDetails ? `+3` :
                  `+3[${game.i18n.localize("WITCHER.Dialog.attackOutsideLOS")}]`;
              }
              if (isExtraAttack) {
                attFormula += !displayRollDetails ? `-3` :
                  `-3[${game.i18n.localize("WITCHER.Dialog.attackExtra")}]`;
              }
              if (isFastDraw) {
                attFormula += !displayRollDetails ? `-3` :
                  `-3[${game.i18n.localize("WITCHER.Dialog.attackIsFastDraw")}]`;
              }
              if (isProne) {
                attFormula += !displayRollDetails ? `-2` :
                  `-2[${game.i18n.localize("WITCHER.Dialog.attackIsProne")}]`;
              }
              if (isPinned) {
                attFormula += !displayRollDetails ? `+4` :
                  `+4[${game.i18n.localize("WITCHER.Dialog.attackIsPinned")}]`;
              }
              if (isActivelyDodging) {
                attFormula += !displayRollDetails ? `-2` :
                  `-2[${game.i18n.localize("WITCHER.Dialog.attackIsActivelyDodging")}]`;
              }
              if (isMoving) {
                attFormula += !displayRollDetails ? `-3` :
                  `-3[${game.i18n.localize("WITCHER.Dialog.attackIsMoving")}]`;
              }
              if (isAmbush) {
                attFormula += !displayRollDetails ? `+5` :
                  `+5[${game.i18n.localize("WITCHER.Dialog.attackIsAmbush")}]`;
              }
              if (isRicochet) {
                attFormula += !displayRollDetails ? `-5` :
                  `-5[${game.i18n.localize("WITCHER.Dialog.attackIsRicochet")}]`;
              }
              if (isBlinded) {
                attFormula += !displayRollDetails ? `-3` :
                  `-3[${game.i18n.localize("WITCHER.Dialog.attackIsBlinded")}]`;
              }
              if (isSilhouetted) {
                attFormula += !displayRollDetails ? `+2` :
                  `+2[${game.i18n.localize("WITCHER.Dialog.attackIsSilhouetted")}]`;
              }
              if (customAim > 0) {
                attFormula += !displayRollDetails ? `+${customAim}` :
                  `+${customAim}[${game.i18n.localize("WITCHER.Dialog.attackCustom")}]`;
              }

              let modifiers;

              switch (attackSkill.name) {
                case "Brawling":
                  attFormula += !displayRollDetails ? `+${this.actor.system.stats.ref.current}+${this.actor.system.skills.ref.brawling.value}` :
                    `+${this.actor.system.stats.ref.current}[${game.i18n.localize("WITCHER.Actor.Stat.Ref")}]+${this.actor.system.skills.ref.brawling.value}[${game.i18n.localize("WITCHER.SkRefBrawling")}]`;
                  modifiers = this.actor.system.skills.ref.brawling.modifiers;
                  break;
                case "Melee":
                  attFormula += !displayRollDetails ? `+${this.actor.system.stats.ref.current}+${this.actor.system.skills.ref.melee.value}` :
                    `+${this.actor.system.stats.ref.current}[${game.i18n.localize("WITCHER.Actor.Stat.Ref")}]+${this.actor.system.skills.ref.melee.value}[${game.i18n.localize("WITCHER.SkRefMelee")}]`;
                  modifiers = this.actor.system.skills.ref.melee.modifiers;
                  break;
                case "Small Blades":
                  attFormula += !displayRollDetails ? `+${this.actor.system.stats.ref.current}+${this.actor.system.skills.ref.smallblades.value}` :
                    `+${this.actor.system.stats.ref.current}[${game.i18n.localize("WITCHER.Actor.Stat.Ref")}]+${this.actor.system.skills.ref.smallblades.value}[${game.i18n.localize("WITCHER.SkRefSmall")}]`;
                  modifiers = this.actor.system.skills.ref.smallblades.modifiers;
                  break;
                case "Staff/Spear":
                  attFormula += !displayRollDetails ? `+${this.actor.system.stats.ref.current}+${this.actor.system.skills.ref.staffspear.value}` :
                    `+${this.actor.system.stats.ref.current}[${game.i18n.localize("WITCHER.Actor.Stat.Ref")}]+${this.actor.system.skills.ref.staffspear.value}[${game.i18n.localize("WITCHER.SkRefStaff")}]`;
                  modifiers = this.actor.system.skills.ref.staffspear.modifiers;
                  break;
                case "Swordsmanship":
                  attFormula += !displayRollDetails ? `+${this.actor.system.stats.ref.current}+${this.actor.system.skills.ref.swordsmanship.value}` :
                    `+${this.actor.system.stats.ref.current}[${game.i18n.localize("WITCHER.Actor.Stat.Ref")}]+${this.actor.system.skills.ref.swordsmanship.value}[${game.i18n.localize("WITCHER.SkRefSwordsmanship")}]`;
                  modifiers = this.actor.system.skills.ref.swordsmanship.modifiers;
                  break;
                case "Archery":
                  attFormula += !displayRollDetails ? `+${this.actor.system.stats.dex.current}+${this.actor.system.skills.dex.archery.value}` :
                    `+${this.actor.system.stats.dex.current}[${game.i18n.localize("WITCHER.Actor.Stat.Dex")}]+${this.actor.system.skills.dex.archery.value}[${game.i18n.localize("WITCHER.SkDexArchery")}]`;
                  modifiers = this.actor.system.skills.dex.archery.modifiers;
                  break;
                case "Athletics":
                  attFormula += !displayRollDetails ? `+${this.actor.system.stats.dex.current}+${this.actor.system.skills.dex.athletics.value}` :
                    `+${this.actor.system.stats.dex.current}[${game.i18n.localize("WITCHER.Actor.Stat.Dex")}]+${this.actor.system.skills.dex.athletics.value}[${game.i18n.localize("WITCHER.SkDexAthletics")}]`;
                  modifiers = this.actor.system.skills.dex.athletics.modifiers;
                  break;
                case "Crossbow":
                  attFormula += !displayRollDetails ? `+${this.actor.system.stats.dex.current}+${this.actor.system.skills.dex.crossbow.value}` :
                    `+${this.actor.system.stats.dex.current}[${game.i18n.localize("WITCHER.Actor.Stat.Dex")}]+${this.actor.system.skills.dex.crossbow.value}[${game.i18n.localize("WITCHER.SkDexCrossbow")}]`;
                  modifiers = this.actor.system.skills.dex.crossbow.modifiers;
                  break;
              }

              if (customAtt != "0") {
                attFormula += !displayRollDetails ? `+${customAtt}` : `+${customAtt}[${game.i18n.localize("WITCHER.Settings.Custom")}]`;
              }

              switch (range) {
                case "pointBlank":
                  attFormula = !displayRollDetails ? `${attFormula}+5` : `${attFormula}+5[${game.i18n.localize("WITCHER.Weapon.Range")}]`;
                  break;
                case "medium":
                  attFormula = !displayRollDetails ? `${attFormula}-2` : `${attFormula}-2[${game.i18n.localize("WITCHER.Weapon.Range")}]`;
                  break;
                case "long":
                  attFormula = !displayRollDetails ? `${attFormula}-4` : `${attFormula}-4[${game.i18n.localize("WITCHER.Weapon.Range")}]`;
                  break;
                case "extreme":
                  attFormula = !displayRollDetails ? `${attFormula}-6` : `${attFormula}-6[${game.i18n.localize("WITCHER.Weapon.Range")}]`;
                  break;
              }

              if (customDmg != "0") {
                damageFormula += !displayRollDetails ? `+${customDmg}` : `+${customDmg}[${game.i18n.localize("WITCHER.Settings.Custom")}]`;
              }
              damage.formula = damageFormula

              let touchedLocation = this.actor.getLocationObject(location);
              attFormula += !displayRollDetails
                ? `${touchedLocation.modifier}`
                : `${touchedLocation.modifier}[${touchedLocation.alias}]`;
              damage.location = touchedLocation;

              if (strike == "joint" || strike == "strong") {
                attFormula = !displayRollDetails ? `${attFormula}-3` : `${attFormula}-3[${game.i18n.localize("WITCHER.Dialog.attackStrike")}]`;
              }

              attFormula = addModifiers(modifiers, attFormula)
              const attackEffectSkill = {
                Brawling: "WITCHER.SkRefBrawling",
                Melee: "WITCHER.SkRefMelee",
                "Small Blades": "WITCHER.SkRefSmall",
                "Staff/Spear": "WITCHER.SkRefStaff",
                Swordsmanship: "WITCHER.SkRefSwordsmanship",
                Archery: "WITCHER.SkDexArchery",
                Athletics: "WITCHER.SkDexAthletics",
                Crossbow: "WITCHER.SkDexCrossbow",
              }[attackSkill.name];
              attFormula = addActorSkillEffectModifiers(this.actor, attackEffectSkill, attFormula);

              messageData.flavor = `<div class="attack-message" data-location="${touchedLocation.name}"><h1><img src="${item.img}" class="item-img" />${game.i18n.localize("WITCHER.Attack")}: ${item.name}</h1>`;
              messageData.flavor += `<span>  ${game.i18n.localize("WITCHER.Armor.Location")}: ${touchedLocation.alias} = ${touchedLocation.locationFormula} </span>`;

              let config = new RollConfig()
              config.showResult = false
              let roll = await extendedRoll(attFormula, messageData, config)
              const attackTotal = Number(roll.total);
              messageData.flavor = messageData.flavor.replace(
                `class="attack-message"`,
                `class="attack-message" data-attack-total="${attackTotal}"`
              );

              if (item.system.rollOnlyDmg) {
                await rollDamage(item, damage)
              } else {
                let message = await roll.toMessage(messageData);

                await message.setFlag('thewitchertrpg', 'attack', item.getAttackSkillFlags())
                await message.setFlag('thewitchertrpg', 'attackTotal', attackTotal)
                await message.setFlag('thewitchertrpg', 'attackLocation', touchedLocation.name)
                await message.setFlag('thewitchertrpg', 'damage', damage)
              }
            }
          }
        }
      }
    }, myDialogOptions))
  },

  async _onSpellDisplay(event) {
    event.preventDefault();
    let section = event.currentTarget.closest(".spell");
    await this.actor.update({ [`system.pannels.${section.dataset.spelltype}IsOpen`]: !this.actor.system.pannels[section.dataset.spelltype + 'IsOpen'] });
  },

  async _onSubstanceDisplay(event) {
    event.preventDefault();
    let section = event.currentTarget.closest(".substance");
    await this.actor.update({ [`system.pannels.${section.dataset.subtype}IsOpen`]: !this.actor.system.pannels[section.dataset.subtype + 'IsOpen'] });
  },

  itemListener(html) {
    html.find(".add-item").on("click", this._onItemAdd.bind(this));
    html.find(".item-edit").on("click", this._onItemEdit.bind(this));
    html.find(".container-contents-open").on("click", this._onContainerContents.bind(this));
    html.find(".item-show").on("click", this._onItemShow.bind(this));
    html.find(".item-delete").on("click", this._onItemDelete.bind(this));
    html.find(".inline-edit").change(this._onItemInlineEdit.bind(this));
    html.find(".inline-edit").on("click", e => e.stopPropagation())

    html.find(".enhancement-weapon-slot").on("click", this._chooseEnhancement.bind(this));
    html.find(".enhancement-armor-slot").on("click", this._chooseEnhancement.bind(this));

    html.find(".item-weapon-display").on("click", this._onItemDisplayInfo.bind(this));
    html.find(".item-armor-display").on("click", this._onItemDisplayInfo.bind(this));
    html.find(".item-valuable-display").on("click", this._onItemDisplayInfo.bind(this));
    html.find(".item-transport-display").on("click", this._onItemDisplayInfo.bind(this));
    html.find(".item-spell-display").on("click", this._onItemDisplayInfo.bind(this));
    html.find(".item-substance-display").on("click", this._onSubstanceDisplay.bind(this));

    html.find(".spell-display").on("click", this._onSpellDisplay.bind(this));

    html.find(".item-roll").on("click", this._onItemRoll.bind(this));
    html.find(".spell-roll").on("click", this._onSpellRoll.bind(this));

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

}

function getSpellDamageType(spellItem) {
  return spellItem.system.damageType || inferSpellDamageType(spellItem);
}

function getSpellIgnoresArmor(spellItem) {
  return Boolean(spellItem.system.ignoreArmor) || spellEffectIgnoresArmor(spellItem.system.effect);
}

function inferSpellDamageType(spellItem) {
  const source = String(spellItem.system?.source ?? "").toLowerCase();
  const effect = String(spellItem.system?.effect ?? "").toLowerCase();

  if (/slashing,\s*piercing,\s*or\s*bludgeoning/.test(effect)) return "";
  if (/\bslash(?:ing)?\b|\bblade\b/.test(effect)) return "slashing";
  if (/\bpierc(?:e|ing)\b|\bneedle\b|\bspike\b|\bshard\b/.test(effect)) return "piercing";
  if (/\bbludgeon(?:ing)?\b|\bconcussive\b|\bslam\b|\bcrush\b/.test(effect)) return "bludgeoning";
  if (
    ["air", "earth", "fire", "water", "mixedelements"].includes(source)
    || /\bfire\b|\bflame\b|\bburn(?:ing)?\b|\blightning\b|\belectric\b|\bice\b|\bfrost\b|\bfrozen\b|\bacid\b/.test(effect)
  ) {
    return "elemental";
  }

  return "";
}

function spellEffectIgnoresArmor(effect) {
  return /\b(?:cannot|can't)\s+be\s+blocked\s+by\s+armor\b|\bignores?\s+armor\b|\bbypasses?\s+armor\b/i.test(String(effect ?? ""));
}

function escapeAttribute(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

async function chooseSpellAreaTargets(spellItem, candidates) {
  if (!candidates.length) return [];

  let confirmed = false;
  let selectedTargets = [];
  const rows = candidates.map(target => `
    <label class="spell-area-target-choice">
      <input type="checkbox" name="spellAreaTarget" value="${escapeAttribute(target.tokenUuid)}" ${target.isCaster ? "" : "checked"}>
      <img src="${escapeAttribute(target.img)}" alt="">
      <span>${escapeAttribute(target.name)}</span>
      ${target.isCaster ? `<small>${game.i18n.localize("WITCHER.SpellArea.Caster")}</small>` : ""}
    </label>`).join("");

  await buttonDialog({
    title: game.i18n.format("WITCHER.SpellArea.TargetsTitle", { spell: spellItem.name }),
    content: `<div class="spell-area-target-dialog">
      <p>${game.i18n.localize("WITCHER.SpellArea.TargetsHint")}</p>
      <div class="spell-area-target-choices">${rows}</div>
    </div>`,
    buttons: [[game.i18n.localize("WITCHER.Button.Continue"), html => {
      const selectedUuids = new Set(html.find('[name="spellAreaTarget"]:checked').map((_, input) => input.value).get());
      selectedTargets = candidates.filter(target => selectedUuids.has(target.tokenUuid));
      confirmed = true;
    }]],
  });

  return confirmed ? selectedTargets : null;
}

function getValidItemQuantity(requestedQuantity, availableQuantity) {
  const requested = Number(requestedQuantity);
  const available = Number(availableQuantity);
  if (!Number.isInteger(requested) || requested < 1 || !Number.isFinite(available) || available < 1) {
    ui.notifications.error(game.i18n.localize("WITCHER.Items.InvalidQuantity"));
    return 0;
  }

  return Math.min(requested, Math.floor(available));
}
