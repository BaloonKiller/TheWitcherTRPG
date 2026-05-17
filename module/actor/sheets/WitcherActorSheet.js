import { extendedRoll } from "../../scripts/chat.js";
import * as VerbalCombat from "../../scripts/verbalCombat.js";
import { WITCHER } from "../../setup/config.js";
import { addModifiers, calc_currency_weight, calculateInventoryCost, calculateInventoryWeight } from "../../scripts/witcher.js";
import { RollConfig } from "../../scripts/rollConfig.js";
import { openCurrencyLedger } from "../../scripts/currencyLedger.js";
import { advanceCriticalWoundHealing, getCriticalWoundTier } from "../../scripts/criticalWoundHealing.mjs";
import { findOrphanedStoredItems, findUnmarkedStoredItems } from "../../scripts/storedItems.mjs";
import { migrateLegacyContainerItems } from "../../scripts/containerStorage.mjs";

import { ExecuteDefence } from "../../scripts/actions.js";
import { sanitizeMixin } from "../mixins/sanitizeMixin.js"
import { deathsaveMixin } from "../mixins/deathSaveMixin.js";
import { critMixin } from "../mixins/critMixin.js";
import { noteMixin } from "../mixins/noteMixin.js";
import { activeEffectMixin } from "../mixins/activeEffectMixin.js";
import { skillModifierMixin } from "../mixins/skillModifierMixin.js";
import { skillMixin } from "../mixins/skillMixin.js";
import { statMixin } from "../mixins/statMixin.js";
import { itemMixin } from "../mixins/itemMixin.js";
import { WitcherActorSheetV2, WitcherDialog, renderApplication, renderTemplate, sanitizeSheetRenderOptions } from "../../setup/foundry-compat.js";

export default class WitcherActorSheet extends WitcherActorSheetV2 {

  statMap = WITCHER.statMap;
  skillMap = WITCHER.skillMap;

  render(force, options = {}) {
    return super.render(force, sanitizeSheetRenderOptions(options));
  }

  /** @override */
  getData() {
    const context = super.getData();

    context.useAdrenaline = game.settings.get("thewitchertrpg", "useOptionalAdrenaline")
    context.displayRollDetails = game.settings.get("thewitchertrpg", "displayRollsDetails")
    context.useVerbalCombat = game.settings.get("thewitchertrpg", "useOptionalVerbalCombat")
    context.displayRep = game.settings.get("thewitchertrpg", "displayRep")

    context.config = CONFIG.WITCHER;
    CONFIG.Combat.initiative.formula = "1d10 + @stats.ref.current" + (context.displayRollDetails ? "[REF]" : "");

    const actorData = this.actor.toObject(false);
    context.system = actorData.system;
    context.system.critWounds = Object.values(context.system.critWounds ?? {}).map(wound => ({
      ...wound,
      isPermanent: getCriticalWoundTier(wound.effect) === "Deadly",
    }));
    context.isDeathSave = Number(context.system?.derivedStats?.hp?.value) <= 0;
    const orphanedStoredItems = new Set(findOrphanedStoredItems(context.actor.items));
    context.items = context.actor.items.filter(i => !i.system.isStored || orphanedStoredItems.has(i));

    this._prepareGeneralInformation(context);
    this._prepareWeapons(context);
    this._prepareArmor(context);
    this._prepareSpells(context);
    this._prepareItems(context);

    context.isGM = game.user.isGM
    return context;
  }

  _prepareGeneralInformation(context) {
    let actor = context.actor;

    context.oldNotes = actor.getList("note");
    context.notes = actor.system.notes;
    context.activeEffects = actor.getList("effect");
  }

  _prepareSpells(context) {
    context.spells = context.actor.getList("spell");

    context.noviceSpells = context.spells.filter(s => s.system.level == "novice" &&
      (s.system.class == "Spells" || s.system.class == "Invocations" || s.system.class == "Witcher"));

    context.journeymanSpells = context.spells.filter(s => s.system.level == "journeyman" &&
      (s.system.class == "Spells" || s.system.class == "Invocations" || s.system.class == "Witcher"));

    context.masterSpells = context.spells.filter(s => s.system.level == "master" &&
      (s.system.class == "Spells" || s.system.class == "Invocations" || s.system.class == "Witcher"));

    context.hexes = context.spells.filter(s => s.system.class == "Hexes");
    context.rituals = context.spells.filter(s => s.system.class == "Rituals");
    context.magicalgift = context.spells.filter(s => s.system.class == "MagicalGift");
  }

  /**
  * Organize and classify Items for Character sheets.
  */
  _prepareItems(context) {
    let items = context.items;

    context.enhancements = items.filter(i => i.type == "enhancement" && i.system.type != "armor" && !i.system.applied);
    context.runeItems = context.enhancements.filter(e => e.system.type == "rune");
    context.glyphItems = context.enhancements.filter(e => e.system.type == "glyph");
    context.containers = items.filter(i => i.type == "container");

    context.totalWeight = calculateInventoryWeight(context.actor.items) + calc_currency_weight(context.actor.system.currency);
    context.totalCost = calculateInventoryCost(context.actor.items);
  }

  _prepareWeapons(context) {
    context.weapons = context.actor.getList("weapon");
    context.weapons.forEach((weapon) => {
      const enhancementItems = weapon.system.enhancementItems ?? []
      weapon.system.enhancementItems = Array.from(
        { length: Math.max(0, Number(weapon.system.enhancements) || 0) },
        (_, index) => enhancementItems[index] ?? {}
      )
    });
  }

  _prepareArmor(context) {
    context.armors = context.items.filter(function (item) {
      return item.type == "armor" ||
        (item.type == "enhancement" && item.system.type == "armor" && item.system.applied == false)
    });

    context.armors.forEach((armor) => {
      const enhancementItems = armor.system.enhancementItems ?? []
      armor.system.enhancementItems = Array.from(
        { length: Math.max(0, Number(armor.system.enhancements) || 0) },
        (_, index) => enhancementItems[index] ?? {}
      )
    });

  }

  activateListeners(html) {
    super.activateListeners(html);

    if (this.actor.isOwner) {
      migrateLegacyContainerItems(this.actor).catch(error => {
        console.warn("TheWitcherTRPG | Could not migrate legacy container Items.", error);
      });
      Promise.all([
        ...findOrphanedStoredItems(this.actor.items).map(item => (
          item.update({ "system.isStored": false })
        )),
        ...findUnmarkedStoredItems(this.actor.items).map(item => (
          item.update({ "system.isStored": true })
        )),
      ]).catch(error => {
        console.warn("TheWitcherTRPG | Could not restore orphaned stored Items.", error);
      });
    }

    html.find(".life-event-display").on("click", this._onLifeEventDisplay.bind(this));

    html.find(".init-roll").on("click", this._onInitRoll.bind(this));
    html.find(".defence-roll").on("click", this._onDefenceRoll.bind(this));
    html.find(".heal-button").on("click", this._onHeal.bind(this));
    html.find(".verbal-button").on("click", this._onVerbalCombat.bind(this));
    html.find(".currency-ledger-open").on("click", this._onCurrencyLedgerOpen.bind(this));

    html.find("input").focusin(ev => this._onFocusIn(ev));

    //mixins
    this.statListener(html)
    this.skillListener(html)
    this.skillModifierListener(html)

    this.itemListener(html)

    this.deathSaveListener(html)
    this.critListener(html)
    this.noteListener(html)
    this.activeEffectListener(html)
  }


  calcStaminaMulti(origStaCost, value) {
    let staminaMulti = parseInt(origStaCost)
    value = value.replace("/STA", '')
    if (value.includes("d")) {
      let diceAmount = value.split('d')[0];
      let diceType = "d" + value.split('d')[1].replace("/STA", '')
      return (staminaMulti * diceAmount) + diceType;
    }
    else {
      return staminaMulti * value
    }
  }

  async _onInitRoll(event) {
    this.actor.rollInitiative({ createCombatants: true, rerollInitiative: true })
  }

  async _onDefenceRoll(event) {
    return ExecuteDefence(this.actor)
  }

  async _onHeal() {
    let dialogTemplate = `
      <h1>${game.i18n.localize("WITCHER.Heal.title")}</h1>
      <div class="flex">
        <div>
          <div><input id="R" type="checkbox" unchecked/> ${game.i18n.localize("WITCHER.Heal.resting")}</div>
          <div><input id="SF" type="checkbox" unchecked/> ${game.i18n.localize("WITCHER.Heal.sterilized")}</div>
        </div>
        <div>
          <div><input id="HH" type="checkbox" unchecked/> ${game.i18n.localize("WITCHER.Heal.healinghand")}</div>
            <div><input id="HT" type="checkbox" unchecked/> ${game.i18n.localize("WITCHER.Heal.healingTent")}</div>
        </div>
      </div>`;
    renderApplication(new WitcherDialog({
      title: game.i18n.localize("WITCHER.Heal.dialogTitle"),
      content: dialogTemplate,
      buttons: {
        t1: {
          label: game.i18n.localize("WITCHER.Heal.button"),
          callback: async (html) => {
            let rested = html.find("#R")[0].checked;
            let sterFluid = html.find("#SF")[0].checked;
            let healHand = html.find("#HH")[0].checked;
            let healTent = html.find("#HT")[0].checked;

            let actor = this.actor;
            let rec = actor.system.coreStats.rec.current;
            let curHealth = actor.system.derivedStats.hp.value;
            let total_rec = 0;
            let maxHealth = actor.system.derivedStats.hp.max;
            //Calculate healed amount
            if (rested) {
              total_rec += rec;
            }
            else {
              total_rec += Math.floor(rec / 2);
            }
            if (sterFluid) {
              total_rec += 2;
            }
            if (healHand) {
              total_rec += 3;
            }
            if (healTent) {
              total_rec += 2;
            }
            //Update actor health
            await actor.update({ "system.derivedStats.hp.value": Math.min(curHealth + total_rec, maxHealth) })
            await actor.update({ "system.derivedStats.sta.value": actor.system.derivedStats.sta.max });

            ui.notifications.info(`${actor.name} ${game.i18n.localize("WITCHER.Heal.recovered")} ${rested ? game.i18n.localize("WITCHER.Heal.restful") : game.i18n.localize("WITCHER.Heal.active")} ${game.i18n.localize("WITCHER.Heal.day")}`)

            const criticalHealing = advanceCriticalWoundHealing(
              this.actor.system.critWounds,
              this.actor.system.stats.body.max,
            );
            await this.actor.update({ "system.critWounds": criticalHealing.wounds });
          }
        },
        t2: {
          label: `${game.i18n.localize("WITCHER.Button.Cancel")}`,
        }
      },
    }));
  }

  async _onVerbalCombat() {
    const dialogTemplate = await renderTemplate("systems/thewitchertrpg/templates/sheets/verbal-combat.hbs");
    renderApplication(new WitcherDialog({
      title: game.i18n.localize("WITCHER.verbalCombat.DialogTitle"),
      content: dialogTemplate,
      buttons: {
        t1: {
          label: game.i18n.localize("WITCHER.Dialog.ButtonRoll"),
          callback: async (html) => {
            const verbal = html.find('input[name="verbalCombat"]:checked').val();
            if (!verbal) {
              return ui.notifications.warn(game.i18n.localize("WITCHER.Chat.VerbalSelectAction"));
            }
            if (verbal === "Counterargue") {
              return ui.notifications.info(game.i18n.localize("WITCHER.Chat.VerbalCounterargueFromAttack"));
            }

            const customModifier = html.find("[name=customModifiers]").val();
            const customDamageModifier = html.find("[name=customDamageModifiers]").val();
            const rollData = VerbalCombat.buildVerbalRollData(
              this.actor,
              verbal,
              customModifier,
              customDamageModifier
            );
            if (!rollData) {
              return ui.notifications.error(game.i18n.localize("WITCHER.Chat.VerbalResolutionUnavailable"));
            }

            const { action: verbalCombat, actionType, damageFormula, formula: rollFormula } = rollData;
            const vcDmg = damageFormula ?? game.i18n.localize("WITCHER.verbalCombat.None");
            const isAttack = actionType === "attack";
            const actionButtons = isAttack ? `
              <div class="verbalcombat-action-buttons">
                <button type="button" class="vc-defence">
                  <i class="fas fa-shield-alt" aria-hidden="true"></i>
                  <span>${game.i18n.localize("WITCHER.Chat.VerbalDefend")}</span>
                </button>
                <button type="button" class="vcDamage secondary">
                  <i class="fas fa-dice-d6" aria-hidden="true"></i>
                  <span>${game.i18n.localize("WITCHER.Chat.VerbalRollDamageOnly")}</span>
                </button>
              </div>` : damageFormula ? `
              <div class="verbalcombat-action-buttons">
                <button type="button" class="vcDamage secondary">
                  <i class="fas fa-dice-d6" aria-hidden="true"></i>
                  <span>${game.i18n.localize("WITCHER.Chat.VerbalRollDamageOnly")}</span>
                </button>
              </div>` : "";

            const messageData = {
              speaker: ChatMessage.getSpeaker({ actor: this.actor })
            }
            messageData.flavor = `
              <div class="verbalcombat-action-message ${isAttack ? "verbalcombat-attack-message" : ""}">
                <h2>${game.i18n.localize("WITCHER.verbalCombat.Title")}: ${game.i18n.localize(verbalCombat.name)}</h2>
                <div class="verbalcombat-action-damage">
                  <span>${game.i18n.localize("WITCHER.Weapon.Damage")}</span>
                  <strong>${vcDmg}</strong>
                </div>
                <p>${game.i18n.localize(verbalCombat.effect)}</p>
                ${actionButtons}
              </div>`;

            const config = new RollConfig();
            config.showCrit = true;
            await extendedRoll(
              rollFormula,
              messageData,
              config,
              VerbalCombat.createVerbalActionFlags(this.actor, verbal, damageFormula)
            );
          }
        },
        t2: {
          label: `${game.i18n.localize("WITCHER.Button.Cancel")}`,
        }
      },
    }, {
      width: 480,
    }));
  }

  _onFocusIn(event) {
    event.currentTarget.select();
  }

  async _onCurrencyLedgerOpen(event) {
    event.preventDefault();
    await openCurrencyLedger(this.actor, event.currentTarget.dataset.currency);
  }


  async _onLifeEventDisplay(event) {
    event.preventDefault();
    let section = event.currentTarget.closest(".lifeEvents");
    await this.actor.update({ [`system.general.lifeEvents.${section.dataset.event}.isOpened`]: !this.actor.system.general.lifeEvents[section.dataset.event].isOpened });
  }
}

Object.assign(WitcherActorSheet.prototype, statMixin)
Object.assign(WitcherActorSheet.prototype, skillMixin)
Object.assign(WitcherActorSheet.prototype, skillModifierMixin)

Object.assign(WitcherActorSheet.prototype, itemMixin)

Object.assign(WitcherActorSheet.prototype, sanitizeMixin)
Object.assign(WitcherActorSheet.prototype, deathsaveMixin)
Object.assign(WitcherActorSheet.prototype, critMixin)
Object.assign(WitcherActorSheet.prototype, noteMixin)
Object.assign(WitcherActorSheet.prototype, activeEffectMixin)
