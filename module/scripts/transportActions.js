import { extendedRoll } from "./chat.js";
import { RollConfig } from "./rollConfig.js";
import { addModifiers } from "./witcher.js";
import {
  getTransportDerivedStats,
  getTransportRepairRequirement,
  resolveTransportDamage,
} from "./transport.mjs";
import { resolveActorOwnedItems } from "./storedItems.mjs";
import { buildTransportDocumentUpdate } from "./documentUpdates.mjs";
import { WitcherDialog, fromUuidSync, renderApplication } from "../setup/foundry-compat.js";

export async function openTransportControlRoll(actor, transport) {
  if (!actor || !transport) return false;
  const stats = getCurrentTransportStats(transport);
  const skill = actor.system.skills.ref?.[stats.controlSkill];
  if (!skill) return ui.notifications.error(game.i18n.localize("WITCHER.Transport.ControlUnavailable"));

  return renderApplication(new WitcherDialog({
    title: game.i18n.format("WITCHER.Transport.ControlTitle", { transport: transport.name }),
    content: numericDialogContent({ includeDc: true }),
    buttons: {
      roll: {
        label: game.i18n.localize("WITCHER.Dialog.ButtonRoll"),
        callback: async html => {
          const dc = Math.max(0, numberFromInput(html, "dc"));
          const customModifier = numberFromInput(html, "customModifier");
          const displayDetails = game.settings.get("thewitchertrpg", "displayRollsDetails");
          const ref = Number(actor.system.stats.ref.current) || 0;
          const skillValue = Number(skill.value) || 0;
          const control = Number(stats.control) || 0;
          const skillLabel = game.i18n.localize(skill.label);
          let formula = displayDetails
            ? `1d10+${ref}[${game.i18n.localize("WITCHER.Actor.Stat.Ref")}]+${skillValue}[${skillLabel}]+${control}[${game.i18n.localize("WITCHER.Mount.ControlMod")}]`
            : `1d10+${ref}+${skillValue}+${control}`;
          formula = addFormulaModifier(formula, customModifier, displayDetails);
          formula = addModifiers(skill.modifiers, formula);

          const config = new RollConfig();
          config.showCrit = true;
          config.showSuccess = dc > 0;
          config.threshold = dc > 0 ? dc : -1;
          config.thresholdDesc = "WITCHER.Transport.ControlCheck";
          config.tiesSucceed = true;
          config.messageOnFailure = game.i18n.localize("WITCHER.Transport.ControlFailed");
          config.rerollable = false;

          const total = Number(await extendedRoll(formula, {
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<h2>${escapeHtml(transport.name)}: ${game.i18n.localize("WITCHER.Transport.ControlCheck")}</h2>`,
          }, config));

          if (dc > 0 && total < dc) await drawTransportControlLoss(stats.kind);
        },
      },
    },
  }));
}

export async function openMountAthleticsRoll(actor, transport) {
  if (!actor || !transport) return false;
  const athletics = Number.parseFloat(String(transport.system.dex ?? ""));
  if (!Number.isFinite(athletics)) {
    return ui.notifications.warn(game.i18n.localize("WITCHER.Transport.AthleticsUnavailable"));
  }

  return renderApplication(new WitcherDialog({
    title: game.i18n.format("WITCHER.Transport.AthleticsTitle", { transport: transport.name }),
    content: numericDialogContent({ includeDc: true }),
    buttons: {
      roll: {
        label: game.i18n.localize("WITCHER.Dialog.ButtonRoll"),
        callback: async html => {
          const dc = Math.max(0, numberFromInput(html, "dc"));
          const customModifier = numberFromInput(html, "customModifier");
          const displayDetails = game.settings.get("thewitchertrpg", "displayRollsDetails");
          let formula = displayDetails
            ? `1d10+${athletics}[${game.i18n.localize("WITCHER.Mount.Dex")}]`
            : `1d10+${athletics}`;
          formula = addFormulaModifier(formula, customModifier, displayDetails);

          const config = new RollConfig();
          config.showCrit = true;
          config.showSuccess = dc > 0;
          config.threshold = dc > 0 ? dc : -1;
          config.thresholdDesc = "WITCHER.Transport.AthleticsCheck";
          config.tiesSucceed = true;
          await extendedRoll(formula, {
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<h2>${escapeHtml(transport.name)}: ${game.i18n.localize("WITCHER.Transport.AthleticsCheck")}</h2>`,
          }, config);
        },
      },
    },
  }));
}

export async function openTransportDamageDialog(transport) {
  if (!transport) return false;
  const stats = getCurrentTransportStats(transport);
  if (!(stats.hp.max > 0)) {
    return ui.notifications.warn(game.i18n.localize("WITCHER.Transport.HpUnavailable"));
  }

  return renderApplication(new WitcherDialog({
    title: game.i18n.format("WITCHER.Transport.DamageTitle", { transport: transport.name }),
    content: `
      <div class="transport-action-dialog">
        <label>${game.i18n.localize("WITCHER.Transport.Damage")}<input type="number" name="damage" min="0" step="1" value="0"></label>
        <label><input type="checkbox" name="ignoreSp">${game.i18n.localize("WITCHER.Transport.IgnoreSp")}</label>
      </div>`,
    buttons: {
      apply: {
        label: game.i18n.localize("WITCHER.Transport.ApplyDamage"),
        callback: async html => {
          const result = resolveTransportDamage({
            currentHp: stats.hp.value,
            maxHp: stats.hp.max,
            sp: stats.sp,
            damage: numberFromInput(html, "damage"),
            ignoreSp: html.find('[name="ignoreSp"]').prop("checked"),
          });
          await transport.update(buildTransportDocumentUpdate(
            { "system.hpCurrent": result.remainingHp },
            transport.system,
          ));
          ui.notifications.info(game.i18n.format("WITCHER.Transport.DamageApplied", {
            damage: result.hpDamage,
            hp: result.remainingHp,
            max: stats.hp.max,
          }));
        },
      },
    },
  }));
}

export async function openTransportRepairRoll(actor, transport) {
  if (!actor || !transport) return false;
  const stats = getCurrentTransportStats(transport);
  if (stats.kind === "mount") return false;
  const requirement = getTransportRepairRequirement(stats.hp.value, stats.hp.max);
  if (!requirement) return ui.notifications.info(game.i18n.localize("WITCHER.Transport.NoRepairNeeded"));

  return renderApplication(new WitcherDialog({
    title: game.i18n.format("WITCHER.Transport.RepairTitle", { transport: transport.name }),
    content: `
      <div class="transport-action-dialog">
        <p>${game.i18n.format("WITCHER.Transport.RepairRequirement", {
          dc: requirement.dc,
          duration: game.i18n.localize(`WITCHER.Transport.${requirement.durationKey}`),
        })}</p>
        <label>${game.i18n.localize("WITCHER.Settings.Custom")}<input type="number" name="customModifier" step="1" value="0"></label>
      </div>`,
    buttons: {
      roll: {
        label: game.i18n.localize("WITCHER.Transport.Repair"),
        callback: async html => {
          const displayDetails = game.settings.get("thewitchertrpg", "displayRollsDetails");
          const craft = Number(actor.system.stats.cra.current) || 0;
          const skill = actor.system.skills.cra.crafting;
          const skillValue = Number(skill.value) || 0;
          const skillLabel = game.i18n.localize(skill.label);
          let formula = displayDetails
            ? `1d10+${craft}[${game.i18n.localize("WITCHER.StCra")}]+${skillValue}[${skillLabel}]`
            : `1d10+${craft}+${skillValue}`;
          formula = addFormulaModifier(formula, numberFromInput(html, "customModifier"), displayDetails);
          formula = addModifiers(skill.modifiers, formula);

          const config = new RollConfig();
          config.showCrit = true;
          config.showSuccess = true;
          config.threshold = requirement.dc;
          config.thresholdDesc = "WITCHER.Transport.RepairCheck";
          config.tiesSucceed = true;
          config.messageOnSuccess = game.i18n.localize("WITCHER.Transport.RepairSuccess");
          config.messageOnFailure = game.i18n.localize("WITCHER.Transport.RepairFailure");
          config.rerollable = false;
          const total = Number(await extendedRoll(formula, {
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<h2>${escapeHtml(transport.name)}: ${game.i18n.localize("WITCHER.Transport.Repair")}</h2>`,
          }, config));
          if (total >= requirement.dc) {
            await transport.update(buildTransportDocumentUpdate(
              { "system.hpCurrent": stats.hp.max },
              transport.system,
            ));
          }
        },
      },
    },
  }));
}

export async function drawTransportControlLoss(kind) {
  const tableName = kind === "mount" ? "Mounted Control Loss" : "Vehicle Control Loss";
  const table = await findControlLossTable(tableName);
  if (!table) {
    return ui.notifications.warn(game.i18n.format("WITCHER.Transport.ControlTableMissing", { table: tableName }));
  }
  return table.draw({ displayChat: true });
}

function getCurrentTransportStats(transport) {
  const accessories = resolveActorOwnedItems(
    transport.system.accessories,
    transport.actor,
    fromUuidSync,
  );
  return getTransportDerivedStats(transport, accessories);
}

async function findControlLossTable(tableName) {
  const combatPack = game.packs?.get("thewitchertrpg.combat")
    ?? game.packs?.find(pack => pack.metadata?.name === "combat" && pack.documentName === "RollTable");
  if (combatPack) {
    const index = await combatPack.getIndex({ fields: ["name"] });
    const entry = index.find(result => result.name === tableName);
    if (entry) return combatPack.getDocument(entry._id);
  }
  return game.tables?.getName?.(tableName)
    ?? game.tables?.find(table => table.name === tableName)
    ?? null;
}

function numericDialogContent({ includeDc = false } = {}) {
  return `
    <div class="transport-action-dialog">
      ${includeDc ? `<label>${game.i18n.localize("WITCHER.DC")}<input type="number" name="dc" min="0" step="1" value="0"></label>` : ""}
      <label>${game.i18n.localize("WITCHER.Settings.Custom")}<input type="number" name="customModifier" step="1" value="0"></label>
    </div>`;
}

function numberFromInput(html, name) {
  const value = Number(html.find(`[name="${name}"]`).val());
  return Number.isFinite(value) ? value : 0;
}

function addFormulaModifier(formula, modifier, displayDetails) {
  if (!modifier) return formula;
  const term = modifier > 0 ? `+${modifier}` : String(modifier);
  return displayDetails ? `${formula}${term}[${game.i18n.localize("WITCHER.Settings.Custom")}]` : `${formula}${term}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}
