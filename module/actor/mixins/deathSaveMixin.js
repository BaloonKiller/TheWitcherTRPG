import { RollConfig } from "../../scripts/rollConfig.js";
import { extendedRoll } from "../../scripts/chat.js";
import { WitcherDialog, renderApplication } from "../../setup/foundry-compat.js";
import {
  getSaveDetails,
  normalizeLuckSpend,
  normalizeDeathSavePenalty,
  resolveDeathSave,
} from "../../scripts/deathSaves.mjs";

async function chooseDeathSaveLuck(actor) {
  const available = Math.max(0, Math.floor(Number(actor.system.stats.luck.total)) || 0);
  if (actor.type !== "character" || available === 0) return 0;

  return new Promise(resolve => {
    let resolved = false;
    const finish = value => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };
    const content = `
      <div class="death-save-luck-dialog">
        <div><span>${game.i18n.localize("WITCHER.Dialog.DeathSaveLuckAvailable")}</span><strong>${available}</strong></div>
        <label>
          <span>${game.i18n.localize("WITCHER.Dialog.DeathSaveLuckSpend")}</span>
          <input type="number" name="deathSaveLuck" value="0" min="0" max="${available}" step="1" />
        </label>
      </div>`;
    const dialog = new WitcherDialog({
      title: game.i18n.localize("WITCHER.Dialog.DeathSaveLuckTitle"),
      content,
      buttons: {
        roll: {
          label: game.i18n.localize("WITCHER.Dialog.ButtonRoll"),
          callback: html => finish(normalizeLuckSpend(html.find("[name=deathSaveLuck]").val(), available)),
        },
        cancel: {
          label: game.i18n.localize("WITCHER.Button.Cancel"),
          callback: () => finish(null),
        },
      },
      default: "roll",
      close: () => finish(null),
    }, { width: 320 });

    renderApplication(dialog).catch(error => {
      console.error("TheWitcherTRPG | Failed to render Death Save Luck dialog.", error);
      finish(null);
    });
  });
}

export let deathsaveMixin = {
  async _removeDeathSaves(event) {
    event.preventDefault();
    await this.actor.update({
      "system.deathSaves": 0,
      "system.deathSaveFailed": false,
    });
  },

  async _addDeathSaves(event) {
    event.preventDefault();
    await this.actor.update({
      "system.deathSaves": normalizeDeathSavePenalty(Number(this.actor.system.deathSaves) + 1),
    });
  },

  async _onDeathSaveRoll(event) {
    event.preventDefault();

    const save = getSaveDetails({
      hp: this.actor.system.derivedStats.hp.value,
      stun: this.actor.system.coreStats.stun.current,
      body: this.actor.system.stats.body.max,
      will: this.actor.system.stats.will.max,
      deathSaves: this.actor.system.deathSaves,
    });
    if (save.isDeathSave && this.actor.system.deathSaveFailed) {
      return ui.notifications.warn(game.i18n.localize("WITCHER.Actor.DeathSaveAlreadyFailed"));
    }

    if (!save.isDeathSave && (this.actor.system.deathSaves || this.actor.system.deathSaveFailed)) {
      await this.actor.update({
        "system.deathSaves": 0,
        "system.deathSaveFailed": false,
      });
    }

    const luckSpent = save.isDeathSave ? await chooseDeathSaveLuck(this.actor) : 0;
    if (luckSpent === null) return;
    const threshold = Math.max(0, save.base - save.penalty + luckSpent);

    const titleKey = save.isDeathSave ? "WITCHER.Actor.DeathSave" : "WITCHER.Actor.StunSave";
    const penaltyLine = save.isDeathSave ? `
              <div><span>${game.i18n.localize("WITCHER.Chat.SavePenalty")}</span><strong>-${save.penalty}</strong></div>` : "";
    const luckLine = luckSpent > 0 ? `
              <div><span>${game.i18n.localize("WITCHER.Chat.SaveLuck")}</span><strong>+${luckSpent}</strong></div>` : "";

    let messageData = {
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: `
          <div class="save-roll-message ${save.isDeathSave ? "is-death-save" : "is-stun-save"}">
            <h2><i class="fas ${save.isDeathSave ? "fa-skull" : "fa-shield-alt"}" aria-hidden="true"></i>${game.i18n.localize(titleKey)}</h2>
            <div class="save-roll-summary">
              <div><span>${game.i18n.localize("WITCHER.Chat.SaveBase")}</span><strong>${save.base}</strong></div>
              ${penaltyLine}
              ${luckLine}
              <div class="save-roll-target"><span>${game.i18n.localize("WITCHER.Chat.SaveTarget")}</span><strong>&lt; ${threshold}</strong></div>
            </div>
          </div>
          <hr />`
    }

    let config = new RollConfig()
    config.reversal = true
    config.showCrit = false
    config.showSuccess = true
    config.threshold = threshold
    if (save.isDeathSave) {
      config.messageOnSuccess = game.i18n.format("WITCHER.Chat.DeathSaveSurvived", {
        penalty: normalizeDeathSavePenalty(save.penalty + 1),
      });
      config.messageOnFailure = game.i18n.localize("WITCHER.Chat.DeathSaveDied");
      config.onResolved = async ({ success }) => {
        const result = resolveDeathSave({
          isDeathSave: true,
          success,
          deathSaves: save.penalty,
        });
        const updates = {
          "system.deathSaves": result.deathSaves,
          "system.deathSaveFailed": result.deathSaveFailed,
        };
        if (luckSpent > 0) {
          updates["system.stats.luck.total"] = Math.max(
            0,
            Number(this.actor.system.stats.luck.total) - luckSpent,
          );
        }
        await this.actor.update(updates);
      };
    }

    await extendedRoll(`1d10`, messageData, config)
  },

  deathSaveListener(html) {
    html.find(".death-roll").on("click", this._onDeathSaveRoll.bind(this));
    html.find(".death-minus").on("click", this._removeDeathSaves.bind(this));
    html.find(".death-plus").on("click", this._addDeathSaves.bind(this));
  }
}
