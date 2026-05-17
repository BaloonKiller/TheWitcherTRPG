import { extendedRoll } from "../scripts/chat.js";
import { RollConfig } from "../scripts/rollConfig.js";
import { WITCHER } from "../setup/config.js";
import { ItemDocument, ChatMessageDocument, fromUuid } from "../setup/foundry-compat.js";

export default class WitcherItem extends ItemDocument {

  async roll() {
  }

  async createSpellVisualEffectIfApplicable(token) {
    if (this.type == "spell" && token &&
        this.system.createTemplate &&
        this.system.templateType &&
        this.system.templateSize) {

      token = token.document ? token : token._object
      // todo need to  create some property indicating the initial rotation of the token
      // token can be classic south oriented or user avatar which may look to the different direction
      let tokenRotation = 0

      const direction = token.document.rotation - tokenRotation;
      const effect = isFoundryV14OrNewer()
        ? await this.#createSpellRegion(token, direction)
        : await this.#createSpellMeasuredTemplate(token, direction);

      this.visualEffectId = effect?._id;
      this.visualEffectType = isFoundryV14OrNewer() ? "Region" : "MeasuredTemplate";
    }
  }

  async deleteSpellVisualEffect() {
    if (this.visualEffectId && this.system.visualEffectDuration > 0) {
      setTimeout(() => {
        canvas.scene.deleteEmbeddedDocuments(this.visualEffectType ?? "MeasuredTemplate", [this.visualEffectId])
      }, this.system.visualEffectDuration * 1000);
    }
  }

  async #createSpellMeasuredTemplate(token, direction) {
    const templateData = {
      t: this.system.templateType,
      user: game.user.id,
      distance: this.system.templateSize,
      direction,
      x: token.center.x,
      y: token.center.y,
      fillColor: game.user.color,
      flags: this.getSpellFlags()
    };

    switch (this.system.templateType) {
      case "rect":
        templateData.distance = Math.hypot(this.system.templateSize, this.system.templateSize);
        templateData.width = this.system.templateSize;
        templateData.direction = 45;
        break;
      case "cone":
        templateData.angle = 45;
        break;
      case "ray":
        templateData.width = 1;
        break;
    }

    const effects = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [templateData], { keepId: true });
    return effects[0];
  }

  async #createSpellRegion(token, rotation) {
    const regionData = {
      name: this.name,
      color: game.user.color,
      shapes: [this.#getSpellRegionShape(token, rotation)],
      flags: { "thewitchertrpg": { witcher: { origin: { name: this.name } } } }
    };

    const effects = await canvas.scene.createEmbeddedDocuments("Region", [regionData]);
    return effects[0];
  }

  #getSpellRegionShape(token, rotation) {
    const gridDistancePixels = canvas.dimensions.distancePixels;
    const size = Number(this.system.templateSize) * gridDistancePixels;
    const x = token.center.x;
    const y = token.center.y;

    switch (this.system.templateType) {
      case "rect":
        return {
          type: "rectangle",
          x,
          y,
          width: size,
          height: size,
          rotation: 45,
          anchorX: 0.5,
          anchorY: 0.5,
          gridBased: true
        };
      case "cone":
        return {
          type: "cone",
          x,
          y,
          radius: size,
          angle: 45,
          rotation,
          gridBased: true
        };
      case "ray":
        return {
          type: "rectangle",
          x,
          y,
          width: size,
          height: gridDistancePixels,
          rotation,
          anchorX: 0,
          anchorY: 0.5,
          gridBased: true
        };
      case "circle":
      default:
        return {
          type: "circle",
          x,
          y,
          radius: size,
          gridBased: true
        };
    }
  }

  getItemAttackSkill() {
    let alias = "";
    switch (this.system.attackSkill) {
      case "Brawling":
        alias = game.i18n.localize("WITCHER.SkRefBrawling")
        break;
      case "Melee":
        alias = game.i18n.localize("WITCHER.SkRefMelee");
        break;
      case "Small Blades":
        alias = game.i18n.localize("WITCHER.SkRefSmall");
        break;
      case "Staff/Spear":
        alias = game.i18n.localize("WITCHER.SkRefStaff");
        break;
      case "Swordsmanship":
        alias = game.i18n.localize("WITCHER.SkRefSwordsmanship");
        break;
      case "Archery":
        alias = game.i18n.localize("WITCHER.SkDexArchery");
        break;
      case "Athletics":
        alias = game.i18n.localize("WITCHER.SkDexAthletics");
        break;
      case "Crossbow":
        alias = game.i18n.localize("WITCHER.SkDexCrossbow");
        break;
      default:
        break;
    }

    return {
      "name": this.system.attackSkill,
      "alias": alias
    };
  }

  getAttackSkillFlags() {
    return {
      "witcher": { "origin": { "name": this.name } },
      "attackSkill": this.system.attackSkill,
      "item": this,
    }
  }

  getSpellFlags() {
    return {
      "witcher": { "origin": { "name": this.name } },
      "spell": this,
      "item": this,
    }
  }

  doesWeaponNeedMeleeSkillToAttack() {
    if (this.system.attackSkill) {
      //Check whether item attack skill is melee
      //Since actor can throw bombs relying on Athletic which is also a melee attack skill
      //We need specific logic for bomb throws
      let meleeSkill = WITCHER.meleeSkills.includes(this.system.attackSkill)
      let rangedSkill = WITCHER.rangedSkills.includes(this.system.attackSkill)

      if (meleeSkill && rangedSkill) {
        return meleeSkill && !this.system.usingAmmo && !this.system.isThrowable;
      } else {
        return meleeSkill;
      }
    }
  }

  isAlchemicalCraft() {
    return this.system.alchemyDC && this.system.alchemyDC > 0;
  }

  isWeaponThrowable() {
    return this.system.isThrowable;
  }

  populateAlchemyCraftComponentsList() {
    class alchemyComponent {
      name = "";
      alias = "";
      content = "";
      quantity = 0;

      constructor(name, alias, content, quantity) {
        this.name = name;
        this.alias = alias;
        this.content = content;
        this.quantity = quantity;
      }
    }

    let alchemyCraftComponents = [];
    alchemyCraftComponents.push(
      new alchemyComponent(
        "vitriol",
        game.i18n.localize("WITCHER.Inventory.Vitriol"),
        `<img src="systems/thewitchertrpg/assets/images/vitriol.png" class="substance-img" /> <b>${this.system.alchemyComponents.vitriol}</b>`,
        this.system.alchemyComponents.vitriol > 0 ? this.system.alchemyComponents.vitriol : 0
      )
    );
    alchemyCraftComponents.push(
      new alchemyComponent(
        "rebis",
        game.i18n.localize("WITCHER.Inventory.Rebis"),
        `<img src="systems/thewitchertrpg/assets/images/rebis.png" class="substance-img" /> <b>${this.system.alchemyComponents.rebis}</b>`,
        this.system.alchemyComponents.rebis > 0 ? this.system.alchemyComponents.rebis : 0
      )
    );
    alchemyCraftComponents.push(
      new alchemyComponent(
        "aether",
        game.i18n.localize("WITCHER.Inventory.Aether"),
        `<img src="systems/thewitchertrpg/assets/images/aether.png" class="substance-img" /> <b>${this.system.alchemyComponents.aether}</b>`,
        this.system.alchemyComponents.aether > 0 ? this.system.alchemyComponents.aether : 0
      )
    );
    alchemyCraftComponents.push(
      new alchemyComponent(
        "quebrith",
        game.i18n.localize("WITCHER.Inventory.Quebrith"),
        `<img src="systems/thewitchertrpg/assets/images/quebrith.png" class="substance-img" /> <b>${this.system.alchemyComponents.quebrith}</b>`,
        this.system.alchemyComponents.quebrith > 0 ? this.system.alchemyComponents.quebrith : 0
      )
    );
    alchemyCraftComponents.push(
      new alchemyComponent(
        "hydragenum",
        game.i18n.localize("WITCHER.Inventory.Hydragenum"),
        `<img src="systems/thewitchertrpg/assets/images/hydragenum.png" class="substance-img" /> <b>${this.system.alchemyComponents.hydragenum}</b>`,
        this.system.alchemyComponents.hydragenum > 0 ? this.system.alchemyComponents.hydragenum : 0
      )
    );
    alchemyCraftComponents.push(
      new alchemyComponent(
        "vermilion",
        game.i18n.localize("WITCHER.Inventory.Vermilion"),
        `<img src="systems/thewitchertrpg/assets/images/vermilion.png" class="substance-img" /> <b>${this.system.alchemyComponents.vermilion}</b>`,
        this.system.alchemyComponents.vermilion > 0 ? this.system.alchemyComponents.vermilion : 0
      )
    );
    alchemyCraftComponents.push(
      new alchemyComponent(
        "sol",
        game.i18n.localize("WITCHER.Inventory.Sol"),
        `<img src="systems/thewitchertrpg/assets/images/sol.png" class="substance-img" /> <b>${this.system.alchemyComponents.sol}</b>`,
        this.system.alchemyComponents.sol > 0 ? this.system.alchemyComponents.sol : 0
      )
    );
    alchemyCraftComponents.push(
      new alchemyComponent(
        "caelum",
        game.i18n.localize("WITCHER.Inventory.Caelum"),
        `<img src="systems/thewitchertrpg/assets/images/caelum.png" class="substance-img" /> <b>${this.system.alchemyComponents.caelum}</b>`,
        this.system.alchemyComponents.caelum > 0 ? this.system.alchemyComponents.caelum : 0
      )
    );
    alchemyCraftComponents.push(
      new alchemyComponent(
        "fulgur",
        game.i18n.localize("WITCHER.Inventory.Fulgur"),
        `<img src="systems/thewitchertrpg/assets/images/fulgur.png" class="substance-img" /> <b>${this.system.alchemyComponents.fulgur}</b>`,
        this.system.alchemyComponents.fulgur > 0 ? this.system.alchemyComponents.fulgur : 0
      )
    );

    this.system.alchemyCraftComponents = alchemyCraftComponents;
    return alchemyCraftComponents;
  }

  /**
   * @param {string} rollFormula
   * @param {*} messageData 
   * @param {RollConfig} config 
   */
  async realCraft(rollFormula, messageData, config) {
    //we want to show message to the chat only after removal of items from inventory
    config.showResult = false

    //added crit rolls for craft & alchemy
    let roll = await extendedRoll(rollFormula, messageData, config)

    messageData.flavor += `<label><b> ${this.actor.name}</b></label><br/>`;

    let result = roll.total > config.threshold;
    let craftedItemName;
    if (this.system.associatedItem?.name) {
      let craftingComponents = this.isAlchemicalCraft()
        ? this.system.alchemyCraftComponents.filter(c => Number(c.quantity) > 0)
        : this.system.craftingComponents.filter(c => Number(c.quantity) > 0);

      craftingComponents.forEach(c => {
        let componentsToDelete = this.isAlchemicalCraft()
          ? this.actor.getSubstance(c.name)
          : this.actor.findNeededComponent(c.name);

        let componentsCountToDelete = Number(c.quantity);
        let componentsLeftToDelete = componentsCountToDelete;
        let componentsCountDeleted = 0;

        componentsToDelete.forEach(toDelete => {
          let toDeleteCount = Math.min(Number(toDelete.system.quantity), componentsCountToDelete, componentsLeftToDelete);
          if (toDeleteCount <= 0) {
            return ui.notifications.info(`${game.i18n.localize("WITCHER.craft.SkipRemovalOfComponent")}: ${toDelete.name}`);
          }

          if (componentsCountDeleted < componentsCountToDelete) {
            this.actor.removeItem(toDelete._id, toDeleteCount)
            componentsCountDeleted += toDeleteCount;
            componentsLeftToDelete -= toDeleteCount;
            return ui.notifications.info(`${toDeleteCount} ${toDelete.name} ${game.i18n.localize("WITCHER.craft.ItemsSuccessfullyDeleted")} ${this.actor.name}`);
          }
        });

        if (componentsCountDeleted != componentsCountToDelete || componentsLeftToDelete != 0) {
          result = false;
          return ui.notifications.error(game.i18n.localize("WITCHER.err.CraftItemDeletion"));
        }
      });

      if (result) {
        let craftedItem = await fromUuid(this.system.associatedItemUuid)
        ItemDocument.create(craftedItem.toObject(), { parent: this.actor });
        craftedItemName = craftedItem.name;
      }
    } else {
      craftedItemName = game.i18n.localize("WITCHER.craft.SuccessfulCraftForNothing");
    }

    messageData.flavor += `<b>${craftedItemName}</b>`;
    roll.toMessage(messageData);
  }


  /**
   * 
   * @param Number newQuantity 
   * @returns info whether we generated item with the help of the roll table
   */
  async checkIfItemHasRollTable(newQuantity) {
    // search for the compendium pack in the world roll tables by name of the generator
    const compendiumPack = game.packs
      .filter(p => p.metadata.type === "RollTable")
      .filter(c => c.index.find(r => r.name === this.name))

    if (!compendiumPack || compendiumPack.length == 0) {
      // Provided item does not have associated roll table
      // this item should appear in loot sheet as is
      return false
    } else if (compendiumPack.length == 1) {
      // get id of the needed table generator in the compendium pack
      const tableId = compendiumPack[0].index.getName(this.name)._id

      for (let i = 0; i < newQuantity; i++) {
        let roll = await compendiumPack[0].getDocument(tableId).then(el => el.roll())
        let res = roll.results[0]
        let genItem = await fromUuid(res.uuid)

        if (!genItem) {
          return ui.notifications.error(`${game.i18n.localize("WITCHER.Monster.exportLootInvalidItemError")}`)
        }

        // add generated item to the loot sheet
        let itemInLoot = this.actor.items.find(i=> i.name === genItem.name && i.type === genItem.type)
        if (!itemInLoot) {
          await ItemDocument.create(genItem.toObject(), { parent: this.actor })
        } else {
          // if we have already generated item in the loot sheet - increase it's count instead of creation
          let itemToUpdate = itemInLoot[0] ? itemInLoot[0] : itemInLoot
          let itemToUpdateCount = itemToUpdate.system.quantity
          itemToUpdate.update({ 'system.quantity': ++itemToUpdateCount })
        }

        let successMessage = `${game.i18n.localize("WITCHER.Monster.exportLootGenerated")}: ${genItem.name}`
        ui.notifications.info(`${successMessage}`)

        //whisper info about generated items from the roll table
        let chatData = {
          user: game.user._id,
          content: `${successMessage} ${res.getChatText()}`,
          whisper: game.users.filter(u => u.isGM).map(u => u._id)
        };
        ChatMessageDocument.create(chatData, {});
      }

      // remove basic item from the loot sheet
      // this item used for generation the actual item from the roll table
      await this.actor.items.get(this.id).delete()

      return true
    } else {
      return ui.notifications.error(`${game.i18n.localize("WITCHER.Monster.exportLootToManyRollTablesError")}`)
    }
  }
}

function isFoundryV14OrNewer() {
  return Number(game.release?.generation ?? 0) >= 14;
}
