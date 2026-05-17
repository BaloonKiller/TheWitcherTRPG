import WitcherActorSheet from "./WitcherActorSheet.js";
import { addModifiers, sumItemProperty } from "../../scripts/witcher.js";
import { RollConfig } from "../../scripts/rollConfig.js";
import { extendedRoll } from "../../scripts/chat.js";
import { WitcherDialog, renderApplication } from "../../setup/foundry-compat.js";
import {
  openMountAthleticsRoll,
  openTransportControlRoll,
  openTransportDamageDialog,
  openTransportRepairRoll,
} from "../../scripts/transportActions.js";
import { prepareApplicationTab } from "../../scripts/applicationTabs.mjs";

export default class WitcherCharacterSheet extends WitcherActorSheet {

  uniqueTypes = ["profession", "race"]

  /** @override */
  static DEFAULT_OPTIONS = {
    position: {
      width: 1120,
      height: 840,
    },
    template: "systems/thewitchertrpg/templates/sheets/actor/actor-sheet.hbs",
  };

  static TABS = {
    primary: {
      initial: "skills",
      tabs: [
        { id: "skills" },
        { id: "profession" },
        { id: "inventory" },
        { id: "magic" },
        { id: "background" },
      ],
    },
  };

  _isUniqueItem(itemData) {
    return this.uniqueTypes.includes(itemData.type);
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".alchemy-potion").on("click", this._alchemyCraft.bind(this));
    html.find(".crafting-craft").on("click", this._craftinCraft.bind(this));
    html.find(".recipe-learn").on("click", this._toggleRecipeLearned.bind(this));
    html.find(".transport-cargo").on("click", this._onTransportCargo.bind(this));
    html.find(".transport-control").on("click", this._onTransportControl.bind(this));
    html.find(".transport-athletics").on("click", this._onTransportAthletics.bind(this));
    html.find(".transport-damage").on("click", this._onTransportDamage.bind(this));
    html.find(".transport-repair").on("click", this._onTransportRepair.bind(this));
  }

  getData() {
    const context = super.getData();

    this._prepareCharacterData(context);
    this._prepareDiagramFormulas(context);
    this._prepareCrafting(context);
    this._prepareSubstances(context);
    this._prepareAlchemy(context);
    this._prepareValuables(context);

    return context;
  }

  _prepareCharacterData(context) {
    let actor = context.actor;

    context.professions = actor.getList("profession");
    context.profession = context.professions[0];

    context.races = actor.getList("race");
    context.race = context.races[0];

    context.totalStats = this.calc_total_stats(context)
    context.totalSkills = this.calc_total_skills(context)
    context.totalProfSkills = this.calc_total_skills_profession(context)
  }

  _prepareDiagramFormulas(context) {
    // Formulae
    context.diagrams = context.actor.getAvailableRecipes();
    context.recipeMemoryCount = context.actor.getMemorizedRecipeCount();
    context.recipeMemoryCapacity = context.actor.getRecipeMemoryCapacity();
    context.alchemicalItemDiagrams = context.diagrams.filter(d => d.system.type == "alchemical" || !d.system.type).map(this.sanitizeDescription);
    context.potionDiagrams = context.diagrams.filter(d => d.system.type == "potion").map(this.sanitizeDescription);
    context.decoctionDiagrams = context.diagrams.filter(d => d.system.type == "decoction").map(this.sanitizeDescription);
    context.oilDiagrams = context.diagrams.filter(d => d.system.type == "oil").map(this.sanitizeDescription);

    // Diagrams
    context.ingredientDiagrams = context.diagrams.filter(d => d.system.type == "ingredients").map(this.sanitizeDescription);
    context.weaponDiagrams = context.diagrams.filter(d => d.system.type == "weapon").map(this.sanitizeDescription);
    context.armorDiagrams = context.diagrams.filter(d => d.system.type == "armor").map(this.sanitizeDescription);
    context.armorEnhancementDiagrams = context.diagrams.filter(d => d.system.type == "armor-enhancement").map(this.sanitizeDescription);
    context.elderfolkWeaponDiagrams = context.diagrams.filter(d => d.system.type == "elderfolk-weapon").map(this.sanitizeDescription);
    context.elderfolkArmorDiagrams = context.diagrams.filter(d => d.system.type == "elderfolk-armor").map(this.sanitizeDescription);
    context.ammunitionDiagrams = context.diagrams.filter(d => d.system.type == "ammunition").map(this.sanitizeDescription);
    context.bombDiagrams = context.diagrams.filter(d => d.system.type == "bomb").map(this.sanitizeDescription);
    context.trapDiagrams = context.diagrams.filter(d => d.system.type == "traps").map(this.sanitizeDescription);
  }

  _prepareCrafting(context) {
    context.allComponents = context.actor.getList("component");
    context.craftingMaterials = context.allComponents.filter(i => i.system.type == "crafting-material" || i.system.type == "component");
    context.ingotsAndMinerals = context.allComponents.filter(i => i.system.type == "minerals");
    context.hidesAndAnimalParts = context.allComponents.filter(i => i.system.type == "animal-parts");
  }

  _prepareAlchemy(context) {
    let items = context.items;
    context.alchemicalItems = items.filter(i => (i.type == "valuable" && i.system.type == "alchemical-item") || (i.type == "alchemical" && i.system.type == "alchemical"));
    context.witcherPotions = items.filter(i => i.type == "alchemical" && (i.system.type == "decoction" || i.system.type == "potion"));
    context.oils = items.filter(i => i.type == "alchemical" && i.system.type == "oil");
    context.alchemicalTreatments = items.filter(i => i.type == "component" && i.system.type == "alchemical");
    context.mutagens = items.filter(i => i.type == "mutagen");
  }

  _prepareSubstances(context) {
    let actor = context.actor;

    context.substancesVitriol = actor.getSubstance("vitriol");
    context.vitriolCount = sumItemProperty(context.substancesVitriol, "quantity");
    context.substancesRebis = actor.getSubstance("rebis");
    context.rebisCount = sumItemProperty(context.substancesRebis, "quantity");
    context.substancesAether = actor.getSubstance("aether");
    context.aetherCount = sumItemProperty(context.substancesAether, "quantity");
    context.substancesQuebrith = actor.getSubstance("quebrith");
    context.quebrithCount = sumItemProperty(context.substancesQuebrith, "quantity");
    context.substancesHydragenum = actor.getSubstance("hydragenum");
    context.hydragenumCount = sumItemProperty(context.substancesHydragenum, "quantity");
    context.substancesVermilion = actor.getSubstance("vermilion");
    context.vermilionCount = sumItemProperty(context.substancesVermilion, "quantity");
    context.substancesSol = actor.getSubstance("sol");
    context.solCount = sumItemProperty(context.substancesSol, "quantity");
    context.substancesCaelum = actor.getSubstance("caelum");
    context.caelumCount = sumItemProperty(context.substancesCaelum, "quantity");
    context.substancesFulgur = actor.getSubstance("fulgur");
    context.fulgurCount = sumItemProperty(context.substancesFulgur, "quantity");
  }

  _prepareValuables(context) {
    let items = context.items;
    context.valuables = items.filter(i => i.type == "valuable");

    context.clothingAndContainers = context.valuables.filter(i => i.system.type == "clothing" || i.system.type == "containers");
    context.general = context.valuables.filter(i => i.system.type == "genera" || i.system.type == "general" || !i.system.type);
    context.foodAndDrinks = context.valuables.filter(i => i.system.type == "food-drink");
    context.toolkits = context.valuables.filter(i => i.system.type == "toolkit");
    context.questItems = context.valuables.filter(i => i.system.type == "quest-item");

    context.mounts = items.filter(i => i.type == "mount");
    context.mountAccessories = items.filter(i => i.type == "valuable" && i.system.type == "mount-accessories");
  }

  _onTransportControl(event) {
    event.preventDefault();
    return openTransportControlRoll(this.actor, this._getTransportFromEvent(event));
  }

  async _onTransportCargo(event) {
    event.preventDefault();
    const transport = this._getTransportFromEvent(event);
    if (!transport?.sheet) return false;

    const sheet = transport.sheet;
    if (typeof sheet.openLoadout === "function") {
      await sheet.openLoadout();
      return true;
    }

    prepareApplicationTab(sheet, "loadout");
    await renderApplication(sheet);
    return true;
  }

  _onTransportAthletics(event) {
    event.preventDefault();
    return openMountAthleticsRoll(this.actor, this._getTransportFromEvent(event));
  }

  _onTransportDamage(event) {
    event.preventDefault();
    return openTransportDamageDialog(this._getTransportFromEvent(event));
  }

  _onTransportRepair(event) {
    event.preventDefault();
    return openTransportRepairRoll(this.actor, this._getTransportFromEvent(event));
  }

  _getTransportFromEvent(event) {
    const itemId = event.currentTarget.closest(".item")?.dataset.itemId;
    return this.actor.items.get(itemId);
  }

  async _alchemyCraft(event) {
    let displayRollDetails = game.settings.get("thewitchertrpg", "displayRollsDetails")
    let itemId = event.currentTarget.closest(".item").dataset.itemId;
    let item = this.actor.items.get(itemId);
    if (!item?.canCraftRecipe()) {
      return ui.notifications.error(game.i18n.localize("WITCHER.craft.RecipeUnavailable"));
    }
    const hasPhysicalRecipe = item.hasPhysicalRecipe();

    let content = `<label>${game.i18n.localize("WITCHER.Dialog.Crafting")} ${item.name}</label> <br />`;

    let messageData = {
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: `<h1>Crafting</h1>`,
    }

    let areCraftComponentsEnough = true;

    content += `<div class="components-display">`
    let alchemyCraftComponents = item.populateAlchemyCraftComponentsList();
    let alchemyOtherComponents = (item.system.craftingComponents ?? []).filter(c => c.name && Number(c.quantity) > 0);
    alchemyCraftComponents
      .filter(a => a.quantity > 0)
      .forEach(a => {
        content += `<div class="flex">${a.content}</div>`

        let ownedSubstance = this.actor.getSubstance(a.name)
        let ownedSubstanceCount = sumItemProperty(ownedSubstance, "quantity")
        if (ownedSubstanceCount < Number(a.quantity)) {
          let missing = a.quantity - ownedSubstanceCount
          content += `<span class="error-display">${game.i18n.localize("WITCHER.Dialog.NoComponents")}: ${missing} ${a.alias}</span><br />`
          areCraftComponentsEnough = false
        }
      });
    alchemyOtherComponents.forEach(element => {
      content += `<div class="flex"><b>${element.name}</b>(${element.quantity}) </div>`
      let ownedComponent = this.actor.findNeededComponent(element.name);
      let componentQuantity = sumItemProperty(ownedComponent, "quantity");
      if (componentQuantity < Number(element.quantity)) {
        let missing = element.quantity - Number(componentQuantity)
        content += `<span class="error-display">${game.i18n.localize("WITCHER.Dialog.NoComponents")}: ${missing} ${element.name}</span><br />`
        areCraftComponentsEnough = false
      }
    });
    content += `</div>`

    content += this._getRecipeSourceContent(hasPhysicalRecipe);
    content += `<label>${game.i18n.localize("WITCHER.Dialog.RealCrafting")}: <input type="checkbox" name="realCraft"></label> <br />`

    renderApplication(new WitcherDialog({
      title: `${game.i18n.localize("WITCHER.Dialog.AlchemyTitle")}`,
      content,
      buttons: {
        Craft: {
          label: `${game.i18n.localize("WITCHER.Dialog.ButtonCraft")}`,
          callback: async html => {
            let stat = this.actor.system.stats.cra.current;
            let statName = game.i18n.localize(this.actor.system.stats.cra.label);
            let skill = this.actor.system.skills.cra.alchemy.value;
            let skillName = game.i18n.localize(this.actor.system.skills.cra.alchemy.label);
            let realCraft = html.find("[name=realCraft]").prop("checked");
            skillName = skillName.replace(" (2)", "");
            messageData.flavor = `<h1>${game.i18n.localize("WITCHER.Dialog.CraftingAlchemycal")}</h1>`,
              messageData.flavor += `<label>${game.i18n.localize("WITCHER.Dialog.Crafting")}:</label> <b>${item.name}</b> <br />`,
              messageData.flavor += `<label>${game.i18n.localize("WITCHER.Dialog.after")}:</label> <b>${item.system.craftingTime}</b> <br />`,
              messageData.flavor += `${game.i18n.localize("WITCHER.Diagram.alchemyDC")} ${item.system.alchemyDC}`;

            if (!item.isAlchemicalCraft()) {
              stat = this.actor.system.stats.cra.current;
              skill = this.actor.system.skills.cra.crafting.value;
              messageData.flavor = `${game.i18n.localize("WITCHER.Diagram.craftingDC")} ${item.system.craftingDC}`;
            }

            let rollFormula = !displayRollDetails ? `1d10+${stat}+${skill}` : `1d10+${stat}[${statName}]+${skill}[${skillName}]`;

            if (hasPhysicalRecipe) {
              rollFormula += !displayRollDetails ? `+2` : `+2[${game.i18n.localize("WITCHER.Dialog.Diagram")}]`
            }

            rollFormula = addModifiers(this.actor.system.skills.cra.alchemy.modifiers, rollFormula)

            let config = new RollConfig();
            config.showCrit = true
            config.showSuccess = true
            config.threshold = item.system.alchemyDC
            config.thresholdDesc = skillName
            config.tiesSucceed = true
            config.messageOnSuccess = game.i18n.localize("WITCHER.craft.ItemsSuccessfullyCrafted")
            config.messageOnFailure = game.i18n.localize("WITCHER.craft.ItemsNotCrafted")

            if (realCraft) {
              if (areCraftComponentsEnough) {
                await item.realCraft(rollFormula, messageData, config, alchemyCraftComponents);
              } else {
                return ui.notifications.error(`${game.i18n.localize("WITCHER.Dialog.NoComponents")} ${item.system.associatedItem?.name ?? item.name}`)
              }
            } else {
              // Craft without automatic removal components and without real crafting of an item
              await extendedRoll(rollFormula, messageData, config)
            }
          }
        }
      }
    }))
  }

  async _craftinCraft(event) {
    let displayRollDetails = game.settings.get("thewitchertrpg", "displayRollsDetails")
    let itemId = event.currentTarget.closest(".item").dataset.itemId;
    let item = this.actor.items.get(itemId);
    if (!item?.canCraftRecipe()) {
      return ui.notifications.error(game.i18n.localize("WITCHER.craft.RecipeUnavailable"));
    }
    const hasPhysicalRecipe = item.hasPhysicalRecipe();

    let content = `<label>${game.i18n.localize("WITCHER.Dialog.Crafting")} ${item.name}</label> <br />`;

    let messageData = {
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: `<h1>Crafting</h1>`,
    }

    let areCraftComponentsEnough = true;
    content += `<div class="components-display">`;
    const craftingComponents = item.system.craftingComponents ?? [];
    craftingComponents.forEach(element => {
      content += `<div class="flex"><b>${element.name}</b>(${element.quantity}) </div>`
      let ownedComponent = this.actor.findNeededComponent(element.name);
      let componentQuantity = sumItemProperty(ownedComponent, "quantity");
      if (componentQuantity < Number(element.quantity)) {
        let missing = element.quantity - Number(componentQuantity)
        areCraftComponentsEnough = false;
        content += `<span class="error-display">${game.i18n.localize("WITCHER.Dialog.NoComponents")}: ${missing} ${element.name}</span><br />`
      }
    });
    content += `</div>`

    content += this._getRecipeSourceContent(hasPhysicalRecipe);
    content += `<label>${game.i18n.localize("WITCHER.Dialog.RealCrafting")}: <input type="checkbox" name="realCraft"></label> <br />`

    renderApplication(new WitcherDialog({
      title: `${game.i18n.localize("WITCHER.Dialog.CraftingTitle")}`,
      content,
      buttons: {
        Craft: {
          label: `${game.i18n.localize("WITCHER.Dialog.ButtonCraft")}`,
          callback: async html => {
            let stat = this.actor.system.stats.cra.current;
            let statName = game.i18n.localize(this.actor.system.stats.cra.label);
            let skill = this.actor.system.skills.cra.crafting.value;
            let skillName = game.i18n.localize(this.actor.system.skills.cra.crafting.label);
            let realCraft = html.find("[name=realCraft]").prop("checked");
            skillName = skillName.replace(" (2)", "");
            messageData.flavor = `<h1>${game.i18n.localize("WITCHER.Dialog.CraftingItem")}</h1>`,
              messageData.flavor += `<label>${game.i18n.localize("WITCHER.Dialog.Crafting")}:</label> <b>${item.name}</b> <br />`,
              messageData.flavor += `<label>${game.i18n.localize("WITCHER.Dialog.after")}:</label> <b>${item.system.craftingTime}</b> <br />`,
              messageData.flavor += `${game.i18n.localize("WITCHER.Diagram.craftingDC")} ${item.system.craftingDC}`;

            let rollFormula = !displayRollDetails ? `1d10+${stat}+${skill}` : `1d10+${stat}[${statName}]+${skill}[${skillName}]`;

            if (hasPhysicalRecipe) {
              rollFormula += !displayRollDetails ? `+2` : `+2[${game.i18n.localize("WITCHER.Dialog.Diagram")}]`
            }

            rollFormula = addModifiers(this.actor.system.skills.cra.crafting.modifiers, rollFormula)

            let config = new RollConfig();
            config.showCrit = true
            config.showSuccess = true
            config.threshold = item.system.craftingDC
            config.thresholdDesc = skillName
            config.tiesSucceed = true
            config.messageOnSuccess = game.i18n.localize("WITCHER.craft.ItemsSuccessfullyCrafted")
            config.messageOnFailure = game.i18n.localize("WITCHER.craft.ItemsNotCrafted")

            if (realCraft) {
              if (areCraftComponentsEnough) {
                await item.realCraft(rollFormula, messageData, config);
              } else {
                return ui.notifications.error(`${game.i18n.localize("WITCHER.Dialog.NoComponents")} ${item.system.associatedItem?.name ?? item.name}`)
              }
            } else {
              // Craft without automatic removal components and without real crafting of an item
              await extendedRoll(rollFormula, messageData, config)
            }
          }
        }
      }
    }))
  }

  _getRecipeSourceContent(hasPhysicalRecipe) {
    const key = hasPhysicalRecipe ? "PhysicalRecipeBonus" : "MemorizedRecipe";
    return `<div class="recipe-source"><b>${game.i18n.localize(`WITCHER.craft.${key}`)}</b></div>`;
  }

  async _toggleRecipeLearned(event) {
    event.preventDefault();
    event.stopPropagation();
    const itemId = event.currentTarget.closest(".item").dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item || item.type !== "diagrams") return false;

    if (item.system.learned) {
      if (!await this._confirmRecipeForget(item)) return false;
      if (Number(item.system.quantity) > 0) {
        return item.update({ "system.learned": false });
      }
      return item.delete();
    }

    if (!item.hasPhysicalRecipe()) {
      return ui.notifications.error(game.i18n.localize("WITCHER.craft.PhysicalRecipeRequired"));
    }
    if (!this.actor.canMemorizeRecipe(item)) {
      return ui.notifications.error(game.i18n.format("WITCHER.craft.RecipeMemoryFull", {
        count: this.actor.getMemorizedRecipeCount(),
        capacity: this.actor.getRecipeMemoryCapacity(),
      }));
    }

    await item.update({ "system.learned": true });
    return ui.notifications.info(game.i18n.format("WITCHER.craft.RecipeMemorized", { recipe: item.name }));
  }
}
