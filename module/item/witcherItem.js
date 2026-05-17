import { extendedRoll } from "../scripts/chat.js";
import { RollConfig } from "../scripts/rollConfig.js";
import { WITCHER } from "../setup/config.js";
import { canCraftFromRecipe, getRecipeOutputQuantity, hasPhysicalRecipe } from "../scripts/craftingRecipes.mjs";
import { ItemDocument, ChatMessageDocument, fromUuid, fromUuidSync } from "../setup/foundry-compat.js";
import {
  buildPersistentSpellAreaEffect,
  buildSpellAreaDurationData,
  buildSpellAreaShape,
  collectSpellAreaTargets,
  normalizeSpellAreaSize,
} from "../scripts/spellArea.mjs";
import { resolveActorOwnedItems } from "../scripts/storedItems.mjs";

export default class WitcherItem extends ItemDocument {

  async roll() {
  }

  async _preDelete(options, userId) {
    const allowed = await super._preDelete(options, userId);
    if (allowed === false) return allowed;

    if (this.type === "diagrams" && this.parent?.documentName === "Actor"
      && this.system.learned && Number(this.system.quantity) > 0) {
      await this.update({ "system.quantity": 0 });
      ui.notifications.info(game.i18n.localize("WITCHER.craft.PhysicalCopiesDiscarded"));
      return false;
    }

    if (!["container", "mount"].includes(this.type)) return allowed;

    const storedUuids = this.type === "container"
      ? (this.system.content ?? [])
      : [...(this.system.accessories ?? []), ...(this.system.cargo ?? [])];
    const storedItems = resolveActorOwnedItems(storedUuids, this.actor, fromUuidSync)
      .filter(item => item && item.uuid !== this.uuid);
    await Promise.all(storedItems.map(item => item.update({ "system.isStored": false })));
    return allowed;
  }

  async createSpellVisualEffectIfApplicable(token, options = {}) {
    if (this.type !== "spell" || !this.system.createTemplate) return null;
    if (!token || !this.system.templateType || !this.system.templateSize) {
      ui.notifications.warn(game.i18n.localize("WITCHER.SpellArea.NoToken"));
      return { cancelled: true };
    }

    const tokenObject = token.document ? token : token.object;
    if (!tokenObject?.document || !tokenObject.center) {
      ui.notifications.warn(game.i18n.localize("WITCHER.SpellArea.NoToken"));
      return { cancelled: true };
    }

    const size = normalizeSpellAreaSize(this.system.templateSize);
    if (!size) {
      ui.notifications.error(game.i18n.localize("WITCHER.SpellArea.InvalidSize"));
      return { cancelled: true };
    }

    const direction = Number(tokenObject.document.rotation ?? 0);
    ui.notifications.info(game.i18n.format("WITCHER.SpellArea.Place", { spell: this.name }));
    const effect = isFoundryV14OrNewer()
      ? await this.#createSpellRegion(tokenObject, direction, size, options)
      : await this.#createSpellMeasuredTemplate(tokenObject, direction, size);

    if (!effect) return { cancelled: true };
    const type = isFoundryV14OrNewer() ? "Region" : "MeasuredTemplate";
    this.visualEffectId = effect.id;
    this.visualEffectType = type;
    return {
      cancelled: false,
      document: effect,
      type,
      targets: type === "Region" ? collectSpellAreaTargets(effect, tokenObject) : [],
    };
  }

  async deleteSpellVisualEffect(effect = null) {
    const id = effect?.document?.id ?? this.visualEffectId;
    const type = effect?.type ?? this.visualEffectType ?? "MeasuredTemplate";
    let duration = Number(this.system.visualEffectDuration);
    if (!(duration > 0) && /immediate|natychmiast/i.test(String(this.system.duration ?? ""))) {
      duration = 5;
    }

    if (id && duration > 0) {
      setTimeout(() => {
        canvas.scene?.deleteEmbeddedDocuments(type, [id])
          .catch(error => console.warn("TheWitcherTRPG | Could not remove spell visual effect.", error));
      }, duration * 1000);
    }
  }

  async removeSpellVisualEffect(effect = null) {
    const id = effect?.document?.id ?? this.visualEffectId;
    const type = effect?.type ?? this.visualEffectType ?? "MeasuredTemplate";
    if (!id) return;
    await canvas.scene?.deleteEmbeddedDocuments(type, [id]);
  }

  async #createSpellMeasuredTemplate(token, direction, size) {
    const templateData = {
      t: this.system.templateType,
      user: game.user.id,
      distance: size,
      direction,
      x: token.center.x,
      y: token.center.y,
      fillColor: game.user.color,
      flags: this.getSpellFlags()
    };

    switch (this.system.templateType) {
      case "rect":
        templateData.distance = Math.hypot(size, size);
        templateData.width = size;
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

  async #createSpellRegion(token, rotation, size, options = {}) {
    const shape = buildSpellAreaShape(
      this.system.templateType,
      size * canvas.dimensions.distancePixels,
      { rotation, gridPixels: canvas.dimensions.distancePixels },
    );
    if (!shape) return null;

    const persistentEffect = buildPersistentSpellAreaEffect(this, options);
    const duration = buildSpellAreaDurationData(this.system.duration, game.combat);
    const regionData = {
      name: this.name,
      color: game.user.color,
      shapes: [shape],
      restriction: { enabled: true },
      levels: [canvas.level.id],
      highlightMode: "coverage",
      displayMeasurements: true,
      visibility: CONST.REGION_VISIBILITY.ALWAYS,
      ownership: { [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
      flags: {
        "thewitchertrpg": {
          witcher: { origin: { name: this.name } },
          spellArea: {
            actorUuid: this.actor?.uuid ?? null,
            casterTokenUuid: token.document.uuid,
            spellUuid: this.uuid,
            staminaSpent: Number(options.staminaSpent) || 1,
            persistentEffect,
            ...duration,
          },
        },
      },
    };

    const previousLayer = canvas.activeLayer;
    const previousTool = game.activeTool;
    canvas.regions.activate({ tool: "select" });
    try {
      return await canvas.regions.placeRegion(regionData, { allowRotation: true });
    } finally {
      if (previousLayer && previousLayer !== canvas.regions) {
        previousLayer.activate({ tool: previousTool ?? "select" });
      }
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

  hasPhysicalRecipe() {
    return this.type === "diagrams" && hasPhysicalRecipe(this);
  }

  canCraftRecipe() {
    return this.type === "diagrams" && canCraftFromRecipe(this);
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
      isSubstance = true;

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

    return alchemyCraftComponents;
  }

  /**
   * @param {string} rollFormula
   * @param {*} messageData 
   * @param {RollConfig} config 
   */
  async realCraft(rollFormula, messageData, config, providedComponents = null) {
    if (!this.canCraftRecipe()) {
      return ui.notifications.error(game.i18n.localize("WITCHER.craft.RecipeUnavailable"));
    }

    //we want to show message to the chat only after removal of items from inventory
    config.showResult = false
    config.tiesSucceed = true

    //added crit rolls for craft & alchemy
    let roll = await extendedRoll(rollFormula, messageData, config)

    messageData.flavor += `<label><b> ${this.actor.name}</b></label><br/>`;

    let result = roll.total >= config.threshold;
    let craftedItemName = game.i18n.localize("WITCHER.craft.ItemsNotCrafted");
    const craftedItemData = await this.getCraftedItemData();
    if (craftedItemData?.name) {
      const craftingComponents = this.getRealCraftComponents(providedComponents);

      const removalPlan = [];
      let hasAllComponents = true;
      const componentRequirements = new Map();
      for (const component of craftingComponents) {
        const key = component.isSubstance ? `substance:${component.name}` : `component:${component.name}`;
        const requirement = componentRequirements.get(key) ?? {
          name: component.name,
          alias: component.alias ?? component.name,
          isSubstance: Boolean(component.isSubstance),
          quantity: 0,
        };
        requirement.quantity += Number(component.quantity);
        componentRequirements.set(key, requirement);
      }

      for (const requirement of componentRequirements.values()) {
        const componentsToDelete = requirement.isSubstance
          ? this.actor.getSubstance(requirement.name)
          : this.actor.findNeededComponent(requirement.name);
        let remaining = requirement.quantity;

        for (const item of componentsToDelete) {
          const quantity = Math.min(Number(item.system.quantity), remaining);
          if (quantity <= 0) continue;
          removalPlan.push({ item, quantity });
          remaining -= quantity;
          if (remaining === 0) break;
        }

        if (remaining > 0) {
          hasAllComponents = false;
          ui.notifications.error(`${game.i18n.localize("WITCHER.err.CraftItemDeletion")}: ${requirement.alias}`);
          break;
        }
      }

      if (hasAllComponents) {
        for (const { item, quantity } of removalPlan) {
          await this.actor.removeItem(item.id, quantity);
          ui.notifications.info(`${quantity} ${item.name} ${game.i18n.localize("WITCHER.craft.ItemsSuccessfullyDeleted")} ${this.actor.name}`);
        }
      } else {
        result = false;
      }

      if (result) {
        const itemSource = prepareCraftedItemSource(craftedItemData);
        itemSource.system.quantity = getRecipeOutputQuantity(this);
        await ItemDocument.create(itemSource, { parent: this.actor });
        craftedItemName = `${itemSource.name}${Number(itemSource.system.quantity) > 1 ? ` x${itemSource.system.quantity}` : ""}`;
      }
    } else {
      craftedItemName = result
        ? game.i18n.localize("WITCHER.craft.SuccessfulCraftForNothing")
        : game.i18n.localize("WITCHER.craft.ItemsNotCrafted");
    }

    messageData.flavor += `<b>${craftedItemName}</b>`;
    await roll.toMessage(messageData);
  }

  getRealCraftComponents(providedComponents = null) {
    const diagramComponents = (this.system.craftingComponents ?? [])
      .filter(c => c.name && Number(c.quantity) > 0)
      .map(c => ({ ...c, isSubstance: false }));

    if (!this.isAlchemicalCraft()) return diagramComponents;

    const alchemyComponents = (providedComponents ?? this.populateAlchemyCraftComponentsList())
      .filter(c => Number(c.quantity) > 0)
      .map(c => ({ ...c, isSubstance: true }));
    return [...alchemyComponents, ...diagramComponents];
  }

  async getCraftedItemData() {
    const associatedUuid = this.system.associatedItemUuid;
    if (associatedUuid) {
      const item = await fromUuid(associatedUuid);
      if (item) return item.toObject();
    }

    const associatedItem = this.system.associatedItem ?? this._source?.system?.associatedItem;
    if (associatedItem?.name && associatedItem?.type) return associatedItem;

    if (associatedUuid) ui.notifications.error(game.i18n.localize("WITCHER.craft.AssociatedItemMissing"));
    return null;
  }


  /**
   * 
   * @param Number newQuantity 
   * @returns info whether we generated item with the help of the roll table
   */
  async checkIfItemHasRollTable(newQuantity) {
    newQuantity = Number(newQuantity);
    if (!Number.isInteger(newQuantity) || newQuantity < 1) {
      ui.notifications.error(game.i18n.localize("WITCHER.Items.InvalidQuantity"));
      return true;
    }

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
      const tableEntry = compendiumPack[0].index.getName(this.name);
      const tableId = tableEntry?.id ?? tableEntry?._id;
      if (!tableId) {
        ui.notifications.error(game.i18n.localize("WITCHER.Monster.exportLootInvalidItemError"));
        return true;
      }

      const table = await compendiumPack[0].getDocument(tableId);
      if (!table) {
        ui.notifications.error(game.i18n.localize("WITCHER.Monster.exportLootInvalidItemError"));
        return true;
      }

      const generatedResults = [];
      for (let i = 0; i < newQuantity; i++) {
        let roll = await table.roll()
        let res = roll.results?.[0]
        let genItem = await res?.getDocument?.();
        if (!genItem && res?.documentUuid) {
          genItem = await fromUuid(res.documentUuid);
        }

        if (!res || !genItem || genItem.documentName !== "Item") {
          ui.notifications.error(`${game.i18n.localize("WITCHER.Monster.exportLootInvalidItemError")}`)
          return true;
        }
        generatedResults.push({ result: res, item: genItem });
      }

      for (const { result: res, item: genItem } of generatedResults) {
        // add generated item to the loot sheet
        let itemInLoot = this.actor.items.find(i=> i.name === genItem.name && i.type === genItem.type)
        if (!itemInLoot) {
          await ItemDocument.create(genItem.toObject(), { parent: this.actor })
        } else {
          // if we have already generated item in the loot sheet - increase it's count instead of creation
          let itemToUpdateCount = Number(itemInLoot.system.quantity)
          await itemInLoot.update({ 'system.quantity': itemToUpdateCount + 1 })
        }

        let successMessage = `${game.i18n.localize("WITCHER.Monster.exportLootGenerated")}: ${genItem.name}`
        ui.notifications.info(`${successMessage}`)

        //whisper info about generated items from the roll table
        let chatData = {
          user: game.user.id,
          content: `${successMessage} ${res.getChatText?.() ?? genItem.name}`,
          whisper: game.users.filter(u => u.isGM).map(u => u.id)
        };
        await ChatMessageDocument.create(chatData, {});
      }

      // remove basic item from the loot sheet
      // this item used for generation the actual item from the roll table
      await this.actor.items.get(this.id).delete()

      return true
    } else {
      ui.notifications.error(`${game.i18n.localize("WITCHER.Monster.exportLootToManyRollTablesError")}`)
      return true;
    }
  }
}

function isFoundryV14OrNewer() {
  return Number(game.release?.generation ?? 0) >= 14;
}

function deepCloneIfPossible(value) {
  return typeof foundry !== "undefined" && foundry.utils?.deepClone
    ? foundry.utils.deepClone(value)
    : structuredClone(value);
}

function prepareCraftedItemSource(value) {
  const source = deepCloneIfPossible(value);
  source.system ??= {};
  delete source._id;
  delete source.id;
  delete source.folder;
  delete source.sort;
  delete source.ownership;
  return source;
}
