import {
  ExecuteDefence,
  ApplyNormalDamage,
  ApplyNonLethalDamage,
  applySuccessfulBlockWear,
} from "../scripts/actions.js";
import * as VerbalCombat from "./verbalCombat.js";
import { drawCriticalWound, getCriticalWound, getCriticalWoundLocation } from "./criticalWounds.mjs";
import { WitcherDialog, fromUuidSync, renderApplication } from "../setup/foundry-compat.js";
import { rollAttackMessageDamage } from "./attack.js";
import { RollConfig } from "./rollConfig.js";
import { shouldResolveAttackCriticalWound } from "./spellResolution.mjs";
import {
  applySerializedRollConfig,
  createRollRerollFlag,
  getNextRerollChain,
  getRollRerollAvailability,
} from "./rollRerolls.mjs";
import {
  getSpellAreaTarget,
  isSpellAreaDamageReady,
  updateSpellAreaTargetDefence,
  updateSpellAreaMessage,
} from "./spellArea.mjs";

const activeDamageResolutions = new Set();
const activeVerbalDamageResolutions = new Set();
const activeVerbalDefences = new Set();
const activeSpellAreaDefences = new Set();
const activeSpellAreaDamageResolutions = new Set();
const activeSpellAreaEndings = new Set();
const activeRollRerolls = new Set();

export function addChatListeners(html) {
  html = $(html);
  html.off('.thewitchertrpgChat');
  html.on('click.thewitchertrpgChat', "button.shield", onShield)
  html.on('click.thewitchertrpgChat', "button.heal", onHeal)
  html.on('click.thewitchertrpgChat', "button.resolve-damage", onResolveDamage)
  html.on('click.thewitchertrpgChat', "button.spell-area-defence", onSpellAreaDefence)
  html.on('click.thewitchertrpgChat', "button.spell-area-damage", onSpellAreaDamage)
  html.on('click.thewitchertrpgChat', "button.spell-area-resolve-all", onSpellAreaResolveAll)
  html.on('click.thewitchertrpgChat', "button.spell-area-end", onSpellAreaEnd)
  html.on('click.thewitchertrpgChat', "button.roll-reroll", onRollReroll)
  html.on('click.thewitchertrpgChat', "button.vc-defence", onVerbalDefence)
  html.on('click.thewitchertrpgChat', "button.resolve-verbal-damage", onResolveVerbalDamage)
}

export function syncRollRerollMessageControls(message, html) {
  html = $(html);
  const buttons = html.find("button.roll-reroll");
  if (!buttons.length) return;
  const availability = getMessageRerollAvailability(message);
  if (availability.allowed) return;

  const key = availability.reason === "superseded"
    ? "WITCHER.Chat.RerollSuperseded"
    : "WITCHER.Chat.RerollLocked";
  buttons.prop("disabled", true).html(
    `<i class="fas fa-lock" aria-hidden="true"></i><span>${game.i18n.localize(key)}</span>`,
  );
}

async function onRollReroll(event) {
  event.preventDefault();
  const button = event.currentTarget;
  const message = game.messages.get(getContextMessageId(button));
  const reroll = message?.getFlag("thewitchertrpg", "rollReroll");
  const availability = getMessageRerollAvailability(message);
  if (!message || !reroll || !availability.allowed) {
    const key = availability.reason === "permission"
      ? "WITCHER.Chat.RerollDenied"
      : availability.reason === "locked"
        ? "WITCHER.Chat.RerollLockedNotice"
        : "WITCHER.Chat.RerollUnavailable";
    return ui.notifications.warn(game.i18n.localize(key));
  }

  if (activeRollRerolls.has(message.id)) return;
  activeRollRerolls.add(message.id);
  button.disabled = true;
  let revertedBlockWear = null;
  let rerolledMessage = null;
  try {
    const blockWear = message.getFlag("thewitchertrpg", "blockWear");
    if (blockWear) {
      const reverted = await updateBlockWearReliability(
        blockWear,
        blockWear.reliabilityBefore,
        blockWear.reliabilityAfter,
      );
      if (!reverted) throw new Error("Block reliability changed after the original defence roll.");
      revertedBlockWear = blockWear;
    }

    const chain = getNextRerollChain(reroll, message.id);
    rerolledMessage = reroll.kind === "verbalDefence"
      ? await rerollVerbalDefence(reroll, chain)
      : await createRerolledMessage(message, reroll, chain);
    if (!rerolledMessage) throw new Error("The rerolled chat message was not created.");

    await supersedeRollMessage(message, rerolledMessage.id);
    const defenceResolution = rerolledMessage.getFlag("thewitchertrpg", "defenceResolution");
    if (defenceResolution?.sourceAttackMessageId && defenceResolution.targetTokenUuid) {
      await updateSpellAreaTargetDefence(
        defenceResolution.sourceAttackMessageId,
        defenceResolution.targetTokenUuid,
        defenceResolution,
      );
    }
  } catch (error) {
    console.error("TheWitcherTRPG | Failed to reroll a chat result.", error);
    if (revertedBlockWear && !rerolledMessage) {
      await updateBlockWearReliability(
        revertedBlockWear,
        revertedBlockWear.reliabilityAfter,
        revertedBlockWear.reliabilityBefore,
      );
    }
    ui.notifications.error(game.i18n.format("WITCHER.Chat.RerollFailedDetail", {
      error: error?.message ?? game.i18n.localize("WITCHER.Context.unavailable"),
    }));
    button.disabled = false;
  } finally {
    activeRollRerolls.delete(message.id);
  }
}

async function createRerolledMessage(message, reroll, chain) {
  const config = applySerializedRollConfig(new RollConfig(), reroll.config);
  config.showResult = true;
  config.returnMessage = true;
  config.rerollData = reroll.data ?? null;
  config.rerollChain = chain;

  const blockItemId = reroll.data?.blockItemId;
  if (blockItemId) {
    const targetDocument = fromUuidSync(reroll.data?.targetActorUuid);
    const actor = targetDocument?.actor ?? targetDocument;
    config.onResolved = async ({ messageData, success }) => {
      if (success && actor) {
        await applySuccessfulBlockWear(actor, blockItemId, reroll.data?.blockItemType, messageData);
      }
    };
  }

  return extendedRoll(reroll.formula, {
    speaker: cloneData(message.speaker),
    flavor: reroll.baseFlavor,
  }, config);
}

async function rerollVerbalDefence(reroll, chain) {
  const data = reroll.data ?? {};
  const defenderDocument = fromUuidSync(data.defenderActorUuid);
  const defender = defenderDocument?.actor ?? defenderDocument;
  const attackMessage = game.messages.get(data.sourceAttackMessageId);
  if (!defender || !attackMessage) return null;
  return executeVerbalDefence(
    defender,
    attackMessage,
    data.selectedAction,
    data.customModifier,
    data.customDamageModifier,
    chain,
  );
}

async function supersedeRollMessage(message, supersededByMessageId) {
  const reroll = message.getFlag("thewitchertrpg", "rollReroll") ?? {};
  const updates = {
    "flags.thewitchertrpg.rollReroll": {
      ...reroll,
      state: "superseded",
      supersededByMessageId,
    },
  };
  const damageResolution = message.getFlag("thewitchertrpg", "damageResolution");
  if (damageResolution) {
    updates["flags.thewitchertrpg.damageResolution"] = {
      ...damageResolution,
      state: "superseded",
    };
  }
  const verbalResolution = message.getFlag("thewitchertrpg", "verbalCombatResolution");
  if (verbalResolution) {
    updates["flags.thewitchertrpg.verbalCombatResolution"] = {
      ...verbalResolution,
      state: "superseded",
    };
  }
  await message.update(updates);
}

function getMessageRerollAvailability(message) {
  const reroll = message?.getFlag?.("thewitchertrpg", "rollReroll");
  const defenceResolution = message?.getFlag?.("thewitchertrpg", "defenceResolution");
  const damageResolution = message?.getFlag?.("thewitchertrpg", "damageResolution");
  const verbalResolution = message?.getFlag?.("thewitchertrpg", "verbalCombatResolution");
  const sourceMessage = defenceResolution?.sourceAttackMessageId
    ? game.messages?.get(defenceResolution.sourceAttackMessageId)
    : null;
  const area = sourceMessage?.getFlag?.("thewitchertrpg", "spellArea");
  const areaTarget = defenceResolution?.targetTokenUuid
    ? getSpellAreaTarget(area, defenceResolution.targetTokenUuid, defenceResolution.targetActorUuid)
    : null;
  const linkedDamageMessage = defenceResolution ? findDamageMessageForDefence(defenceResolution) : null;
  const blockWear = message?.getFlag?.("thewitchertrpg", "blockWear");
  const canUpdate = Boolean(
    game.user?.isGM
    || message?.isOwner
    || message?.author?.id === game.user?.id
    || message?.user?.id === game.user?.id
  );
  return getRollRerollAvailability({
    reroll,
    damageState: damageResolution?.state,
    verbalState: verbalResolution?.state,
    areaTargetState: areaTarget?.state,
    hasDamageRoll: Boolean(
      damageResolution?.damageMessageId
      || verbalResolution?.damageMessageId
      || areaTarget?.damageMessageId
      || linkedDamageMessage
    ),
    hasAppliedConsequence: Boolean(
      (blockWear && !canRevertBlockWear(blockWear))
      || linkedDamageMessage?.getFlag?.("thewitchertrpg", "damageApplications")?.length
    ),
    canUpdate,
  });
}

function canRevertBlockWear(blockWear) {
  const context = getBlockWearContext(blockWear);
  return Boolean(context && context.currentReliability === Number(blockWear.reliabilityAfter));
}

async function updateBlockWearReliability(blockWear, nextReliability, expectedReliability) {
  const context = getBlockWearContext(blockWear);
  if (!context || context.currentReliability !== Number(expectedReliability)) return false;
  await context.item.update({ [`system.${context.reliabilityField}`]: Number(nextReliability) });
  return true;
}

function getBlockWearContext(blockWear) {
  const actorDocument = blockWear?.actorUuid ? fromUuidSync(blockWear.actorUuid) : null;
  const actor = actorDocument?.actor ?? actorDocument;
  const item = actor?.items?.get(blockWear?.itemId);
  const reliabilityField = blockWear?.itemType === "Weapon" ? "reliable" : "reliability";
  const currentReliability = Number(item?.system?.[reliabilityField]);
  const reliabilityBefore = Number(blockWear?.reliabilityBefore);
  const reliabilityAfter = Number(blockWear?.reliabilityAfter);
  if (!item
    || !Number.isFinite(currentReliability)
    || !Number.isFinite(reliabilityBefore)
    || !Number.isFinite(reliabilityAfter)) {
    return null;
  }
  return { item, reliabilityField, currentReliability };
}

async function onSpellAreaEnd(event) {
  event.preventDefault();
  const button = event.currentTarget;
  const attackMessage = game.messages.get(getContextMessageId(button));
  const area = attackMessage?.getFlag("thewitchertrpg", "spellArea");
  const region = area?.regionUuid ? fromUuidSync(area.regionUuid) : null;
  if (!attackMessage || !area || area.ended || !region) {
    return ui.notifications.error(game.i18n.localize("WITCHER.SpellArea.Unavailable"));
  }
  if (!game.user?.isGM && !region.isOwner) {
    return ui.notifications.warn(game.i18n.localize("WITCHER.SpellArea.EndDenied"));
  }

  const key = region.uuid;
  if (activeSpellAreaEndings.has(key)) return;
  activeSpellAreaEndings.add(key);
  button.disabled = true;
  try {
    await region.delete({ witcherSpellAreaEndReason: "manual" });
  } catch (error) {
    console.error("TheWitcherTRPG | Failed to end spell area.", error);
    ui.notifications.error(game.i18n.localize("WITCHER.SpellArea.EndFailed"));
    button.disabled = false;
  } finally {
    activeSpellAreaEndings.delete(key);
  }
}

async function onSpellAreaDefence(event) {
  event.preventDefault();
  const button = event.currentTarget;
  const attackMessage = game.messages.get(getContextMessageId(button));
  const area = attackMessage?.getFlag("thewitchertrpg", "spellArea");
  const target = getSpellAreaTarget(area, button.dataset.targetTokenUuid);
  const actor = getSpellAreaTargetActor(target);
  if (!attackMessage || !area || !target || !actor || target.state !== "pending") {
    return ui.notifications.error(game.i18n.localize("WITCHER.SpellArea.Unavailable"));
  }

  const key = `${attackMessage.id}:${target.tokenUuid}`;
  if (activeSpellAreaDefences.has(key)) return;
  activeSpellAreaDefences.add(key);
  button.disabled = true;
  try {
    await ExecuteDefence(
      actor,
      "Spell",
      attackMessage.getFlag("thewitchertrpg", "attackLocation") ?? "randomSpell",
      Number(area.attackTotal),
      attackMessage.id,
      area.defence,
      { targetTokenUuid: target.tokenUuid },
    );
  } finally {
    activeSpellAreaDefences.delete(key);
    button.disabled = false;
  }
}

async function onSpellAreaDamage(event) {
  event.preventDefault();
  const button = event.currentTarget;
  const attackMessage = game.messages.get(getContextMessageId(button));
  await resolveSpellAreaTargetDamage(attackMessage, button.dataset.targetTokenUuid);
}

async function onSpellAreaResolveAll(event) {
  event.preventDefault();
  const button = event.currentTarget;
  const attackMessage = game.messages.get(getContextMessageId(button));
  const area = attackMessage?.getFlag("thewitchertrpg", "spellArea");
  if (!attackMessage || !area) {
    return ui.notifications.error(game.i18n.localize("WITCHER.SpellArea.Unavailable"));
  }

  button.disabled = true;
  for (const target of area.targets.filter(isSpellAreaDamageReady)) {
    await resolveSpellAreaTargetDamage(attackMessage, target.tokenUuid);
  }
}

async function resolveSpellAreaTargetDamage(attackMessage, tokenUuid) {
  let area = attackMessage?.getFlag("thewitchertrpg", "spellArea");
  let target = getSpellAreaTarget(area, tokenUuid);
  const targetActor = getSpellAreaTargetActor(target);
  if (!attackMessage || !area?.hasDamage || !target || !targetActor || !isSpellAreaDamageReady(target)) {
    return ui.notifications.error(game.i18n.localize("WITCHER.SpellArea.Unavailable"));
  }

  const key = `${attackMessage.id}:${target.tokenUuid}`;
  if (activeSpellAreaDamageResolutions.has(key)) return;
  activeSpellAreaDamageResolutions.add(key);
  const previousState = target.state;
  let damageMessage = target.damageMessageId ? game.messages.get(target.damageMessageId) : null;

  try {
    await updateSpellAreaMessage(attackMessage, {
      tokenUuid: target.tokenUuid,
      targetPatch: { state: "rolling" },
    });

    const defenceResolution = target.defenceResolution ?? {
      attackTotal: Number(area.attackTotal),
      defenceTotal: null,
      margin: 0,
      criticalWound: null,
      bonusDamage: 0,
      hitLocation: attackMessage.getFlag("thewitchertrpg", "attackLocation") ?? "randomSpell",
      criticalLocation: null,
      criticalResult: null,
      sourceAttackMessageId: attackMessage.id,
      targetActorUuid: target.actorUuid,
      targetTokenUuid: target.tokenUuid,
    };

    if (!damageMessage) {
      damageMessage = await rollAttackMessageDamage(
        attackMessage,
        defenceResolution,
        null,
        { baseDamageTotal: area.baseDamageTotal },
      );
      if (!damageMessage) throw new Error("Spell area damage roll could not be created.");
    }

    const hasBaseDamageTotal = area.baseDamageTotal !== null
      && area.baseDamageTotal !== undefined
      && area.baseDamageTotal !== "";
    const baseDamageTotal = hasBaseDamageTotal && Number.isFinite(Number(area.baseDamageTotal))
      ? Number(area.baseDamageTotal)
      : Number(damageMessage.rolls?.at(-1)?.total);
    await updateSpellAreaMessage(attackMessage, {
      tokenUuid: target.tokenUuid,
      targetPatch: { state: "rolled", damageMessageId: damageMessage.id },
      areaPatch: {
        baseDamageTotal,
        baseDamageMessageId: area.baseDamageMessageId ?? damageMessage.id,
      },
    });

    const result = await ApplyNormalDamage(targetActor, Number(damageMessage.rolls?.at(-1)?.total), damageMessage.id);
    await updateSpellAreaMessage(attackMessage, {
      tokenUuid: target.tokenUuid,
      targetPatch: {
        state: ["applied", "alreadyApplied"].includes(result?.status) ? "applied" : "rolled",
        damageMessageId: damageMessage.id,
      },
    });
  } catch (error) {
    console.error("TheWitcherTRPG | Failed to resolve spell area target.", error);
    await updateSpellAreaMessage(attackMessage, {
      tokenUuid: target.tokenUuid,
      targetPatch: {
        state: damageMessage ? "rolled" : previousState,
        damageMessageId: damageMessage?.id ?? null,
      },
    });
    ui.notifications.error(game.i18n.localize("WITCHER.SpellArea.ResolutionFailed"));
  } finally {
    activeSpellAreaDamageResolutions.delete(key);
  }
}

function getSpellAreaTargetActor(target) {
  if (!target) return null;
  const tokenDocument = fromUuidSync(target.tokenUuid);
  const actorDocument = fromUuidSync(target.actorUuid);
  return tokenDocument?.actor ?? actorDocument?.actor ?? actorDocument ?? null;
}

async function onResolveDamage(event) {
  event.preventDefault();

  const button = event.currentTarget;
  const defenceMessage = game.messages.get(getContextMessageId(button));
  const defenceResolution = defenceMessage?.getFlag("thewitchertrpg", "defenceResolution");
  if (!defenceMessage || !defenceResolution || Number(defenceResolution.margin) <= 0) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Chat.DamageResolutionUnavailable"));
  }

  const currentState = defenceMessage.getFlag("thewitchertrpg", "damageResolution") ?? {};
  if (["preparing", "rolling"].includes(currentState.state)) return;

  const targetDocument = fromUuidSync(defenceResolution.targetActorUuid);
  const targetActor = targetDocument?.actor ?? targetDocument;
  const attackMessage = game.messages.get(defenceResolution.sourceAttackMessageId);
  if (!targetActor || !attackMessage) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Chat.DamageResolutionUnavailable"));
  }

  if (currentState.state === "applied") {
    return ui.notifications.warn(game.i18n.format("WITCHER.Chat.DamageAlreadyResolved", { target: targetActor.name }));
  }

  const resolutionKey = defenceMessage.id;
  if (activeDamageResolutions.has(resolutionKey)) return;
  activeDamageResolutions.add(resolutionKey);

  const derivedStat = button.dataset.derivedStat === "sta" ? "sta" : "hp";
  button.disabled = true;

  let damageMessage = currentState.damageMessageId
    ? game.messages.get(currentState.damageMessageId)
    : findDamageMessageForDefence(defenceResolution);

  try {
    if (!damageMessage) {
      await setDefenceDamageResolution(defenceMessage, {
        state: "rolling",
        derivedStat,
        targetActorUuid: defenceResolution.targetActorUuid,
      });
      damageMessage = await rollAttackMessageDamage(attackMessage, defenceResolution);
      if (!damageMessage) {
        throw new Error("Damage roll could not be created from the source attack message.");
      }
    }

    await setDefenceDamageResolution(defenceMessage, {
      state: "rolled",
      damageMessageId: damageMessage.id,
      derivedStat,
      targetActorUuid: defenceResolution.targetActorUuid,
    });

    const totalDamage = Number(damageMessage.rolls?.at(-1)?.total);
    const result = derivedStat === "sta"
      ? await ApplyNonLethalDamage(targetActor, totalDamage, damageMessage.id)
      : await ApplyNormalDamage(targetActor, totalDamage, damageMessage.id);

    if (["applied", "alreadyApplied"].includes(result?.status)) {
      await setDefenceDamageResolution(defenceMessage, {
        state: "applied",
        damageMessageId: damageMessage.id,
        derivedStat,
        targetActorUuid: defenceResolution.targetActorUuid,
        appliedAt: Date.now(),
      });
    }
  } catch (error) {
    console.error("TheWitcherTRPG | Failed to resolve damage from defence.", error);
    await setDefenceDamageResolution(defenceMessage, {
      state: damageMessage ? "rolled" : "ready",
      damageMessageId: damageMessage?.id ?? null,
      derivedStat,
      targetActorUuid: defenceResolution.targetActorUuid,
    });
    ui.notifications.error(game.i18n.localize("WITCHER.Chat.DamageResolutionFailed"));
  } finally {
    activeDamageResolutions.delete(resolutionKey);
    const finalState = defenceMessage.getFlag("thewitchertrpg", "damageResolution")?.state;
    button.disabled = ["rolling", "applied"].includes(finalState);
  }
}

async function setDefenceDamageResolution(message, resolution) {
  await message.setFlag("thewitchertrpg", "damageResolution", resolution);
}

function findDamageMessageForDefence(defenceResolution) {
  const messages = game.messages?.contents ?? Array.from(game.messages ?? []);
  return [...messages].reverse().find(message => {
    const damage = message.getFlag?.("thewitchertrpg", "damage");
    const linkedDefence = damage?.defenceResolution;
    return linkedDefence?.sourceAttackMessageId === defenceResolution.sourceAttackMessageId
      && linkedDefence?.targetActorUuid === defenceResolution.targetActorUuid;
  }) ?? null;
}

async function onVerbalDefence(event) {
  event.preventDefault();

  const button = event.currentTarget;
  const attackMessage = game.messages.get(getContextMessageId(button));
  const action = attackMessage?.getFlag("thewitchertrpg", "verbalCombatAction");
  const attackTotal = Number(attackMessage?.rolls?.at(-1)?.total);
  const defender = getInteractActor();
  if (!attackMessage || action?.type !== "attack" || !Number.isFinite(attackTotal) || !defender) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Chat.VerbalResolutionUnavailable"));
  }

  if (action.actorUuid === defender.uuid) {
    return ui.notifications.warn(game.i18n.localize("WITCHER.Chat.VerbalSelectDefender"));
  }
  if (findVerbalDefenceMessage(attackMessage.id, defender.uuid)) {
    return ui.notifications.warn(game.i18n.format("WITCHER.Chat.VerbalAlreadyDefended", { target: defender.name }));
  }

  const defenceKey = `${attackMessage.id}:${defender.uuid}`;
  if (activeVerbalDefences.has(defenceKey)) return;
  activeVerbalDefences.add(defenceKey);
  button.disabled = true;
  let resolving = false;

  const regularOptions = ["Ignore", "ChangeSubject", "Disengage"]
    .map(key => `<option value="${key}">${game.i18n.localize(VerbalCombat.getVerbalAction(key).name)}</option>`)
    .join("");
  const counterargueOptions = VerbalCombat.VERBAL_ATTACK_ACTIONS
    .map(key => `<option value="Counterargue:${key}">${game.i18n.format("WITCHER.Chat.VerbalCounterargueWith", {
      action: game.i18n.localize(VerbalCombat.getVerbalAction(key).name),
    })}</option>`)
    .join("");
  const attackName = game.i18n.localize(attackMessage.getFlag("thewitchertrpg", "verbalCombat")?.name ?? action.key);
  const content = `
    <div class="verbal-defence-dialog">
      <div class="verbal-defence-summary">
        <span>${game.i18n.localize("WITCHER.Chat.VerbalIncomingAction")}</span>
        <strong>${attackName} (${attackTotal})</strong>
      </div>
      <label>
        <span>${game.i18n.localize("WITCHER.Chat.VerbalDefenceAction")}</span>
        <select name="verbalDefenceAction">
          ${regularOptions}
          <optgroup label="${game.i18n.localize("WITCHER.verbalCombat.Counterargue")}">
            ${counterargueOptions}
          </optgroup>
        </select>
      </label>
      <label>
        <span>${game.i18n.localize("WITCHER.Chat.VerbalRollModifier")}</span>
        <input type="number" name="customModifier" value="0" step="1" />
      </label>
      <label>
        <span>${game.i18n.localize("WITCHER.Chat.VerbalDamageModifier")}</span>
        <input type="number" name="customDamageModifier" value="0" step="1" />
      </label>
    </div>`;

  await renderApplication(new WitcherDialog({
    title: game.i18n.localize("WITCHER.Chat.VerbalDefenceTitle"),
    content,
    buttons: {
      defend: {
        label: game.i18n.localize("WITCHER.Chat.VerbalDefend"),
        callback: async html => {
          resolving = true;
          const selectedAction = html.find("[name=verbalDefenceAction]").val();
          const customModifier = html.find("[name=customModifier]").val();
          const customDamageModifier = html.find("[name=customDamageModifier]").val();
          try {
            await executeVerbalDefence(
              defender,
              attackMessage,
              selectedAction,
              customModifier,
              customDamageModifier
            );
          } catch (error) {
            console.error("TheWitcherTRPG | Failed to roll verbal combat defence.", error);
            ui.notifications.error(game.i18n.localize("WITCHER.Chat.VerbalResolutionFailed"));
          } finally {
            activeVerbalDefences.delete(defenceKey);
            button.disabled = false;
          }
        },
      },
      cancel: {
        label: game.i18n.localize("WITCHER.Button.Cancel"),
      },
    },
    default: "defend",
    close: () => {
      if (!resolving) {
        activeVerbalDefences.delete(defenceKey);
        button.disabled = false;
      }
    },
  }, {
    width: 420,
  }));
}

async function executeVerbalDefence(
  defender,
  attackMessage,
  selectedAction,
  customModifier,
  customDamageModifier,
  rerollChain = null,
) {
  const [selectionType, counterargueActionKey] = String(selectedAction ?? "").split(":");
  const isCounterargue = selectionType === "Counterargue";
  const defenceActionKey = isCounterargue ? counterargueActionKey : selectionType;
  const rollData = VerbalCombat.buildVerbalRollData(
    defender,
    defenceActionKey,
    customModifier,
    customDamageModifier
  );
  const attackTotal = Number(attackMessage.rolls?.at(-1)?.total);
  if (!rollData || !Number.isFinite(attackTotal)) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Chat.VerbalResolutionUnavailable"));
  }

  const defenceLabel = isCounterargue
    ? game.i18n.format("WITCHER.Chat.VerbalCounterargueWith", { action: game.i18n.localize(rollData.action.name) })
    : game.i18n.localize(rollData.action.name);
  const sourceAction = attackMessage.getFlag("thewitchertrpg", "verbalCombatAction");
  const attackLabel = game.i18n.localize(attackMessage.getFlag("thewitchertrpg", "verbalCombat")?.name ?? sourceAction?.key);
  const messageData = {
    speaker: ChatMessage.getSpeaker({ actor: defender }),
    flavor: `
      <div class="verbalcombat-defence-message">
        <h2>${game.i18n.localize("WITCHER.Chat.VerbalDefenceTitle")}: ${defenceLabel}</h2>
        <div class="verbalcombat-versus">
          <span>${game.i18n.localize("WITCHER.Chat.VerbalAgainst")}</span>
          <strong>${attackLabel}</strong>
        </div>
      </div>`,
  };
  const config = new RollConfig();
  config.threshold = attackTotal;
  config.showCrit = true;
  config.showSuccess = false;
  config.opposedDefence = !isCounterargue;
  config.rerollData = {
    kind: "verbalDefence",
    defenderActorUuid: defender.uuid,
    sourceAttackMessageId: attackMessage.id,
    selectedAction,
    customModifier,
    customDamageModifier,
  };
  config.rerollChain = rerollChain;
  config.returnMessage = Boolean(rerollChain);
  config.onResolved = result => appendVerbalDefenceResolution({
    ...result,
    attackMessage,
    defender,
    defenceActionKey,
    defenceDamageFormula: rollData.damageFormula,
    isCounterargue,
  });

  return extendedRoll(rollData.formula, messageData, config);
}

function appendVerbalDefenceResolution({
  messageData,
  total: defenceTotal,
  threshold: attackTotal,
  success: defenceSucceeded,
  attackMessage,
  defender,
  defenceActionKey,
  defenceDamageFormula,
  isCounterargue,
}) {
  const sourceAction = attackMessage.getFlag("thewitchertrpg", "verbalCombatAction") ?? {};
  const attackAction = attackMessage.getFlag("thewitchertrpg", "verbalCombat");
  const attackDamage = attackMessage.getFlag("thewitchertrpg", "damage") ?? {};
  const successfulDisengage = defenceSucceeded && !isCounterargue && defenceActionKey === "Disengage";
  const damageActionKey = defenceSucceeded ? defenceActionKey : sourceAction.key;
  const damageAction = defenceSucceeded ? VerbalCombat.getVerbalAction(defenceActionKey) : attackAction;
  const damageFormula = defenceSucceeded ? defenceDamageFormula : attackDamage.formula;
  const damageTargetActorUuid = defenceSucceeded ? sourceAction.actorUuid : defender.uuid;
  const targetDocument = damageTargetActorUuid ? fromUuidSync(damageTargetActorUuid) : null;
  const targetActor = targetDocument?.actor ?? targetDocument;
  const canResolveDamage = !successfulDisengage && Boolean(damageFormula && damageTargetActorUuid);
  const resultLabel = successfulDisengage
    ? "WITCHER.Chat.VerbalDisengaged"
    : defenceSucceeded
      ? isCounterargue
        ? "WITCHER.Chat.VerbalCounterargueSucceeded"
        : "WITCHER.Chat.VerbalDefended"
      : "WITCHER.Chat.VerbalAttackLanded";
  const resultIcon = successfulDisengage
    ? "fa-door-open"
    : defenceSucceeded
      ? "fa-shield-alt"
      : "fa-comment-slash";
  const resolutionAction = canResolveDamage ? `
    <div class="verbal-resolution-actions">
      <button type="button" class="resolve-verbal-damage">
        <i class="fas fa-heart-broken" aria-hidden="true"></i>
        <span>${game.i18n.localize("WITCHER.Chat.VerbalResolveDamage")}</span>
      </button>
    </div>` : "";

  messageData.flavor += `
    <div class="verbal-resolution ${defenceSucceeded ? "is-defended" : "is-hit"}">
      <div class="verbal-resolution-result">
        <i class="fas ${resultIcon}" aria-hidden="true"></i>
        <strong>${game.i18n.localize(resultLabel)}</strong>
      </div>
      <div class="verbal-resolution-line">
        <span>${game.i18n.localize("WITCHER.Chat.AttackTotal")}</span>
        <strong>${attackTotal}</strong>
      </div>
      <div class="verbal-resolution-line">
        <span>${game.i18n.localize("WITCHER.Chat.DefenceTotal")}</span>
        <strong>${defenceTotal}</strong>
      </div>
      ${canResolveDamage ? `
        <div class="verbal-resolution-line">
          <span>${game.i18n.localize("WITCHER.Chat.VerbalDamageSource")}</span>
          <strong>${game.i18n.localize(damageAction?.name ?? damageActionKey)}</strong>
        </div>
        <div class="verbal-resolution-line">
          <span>${game.i18n.localize("WITCHER.Chat.VerbalDamageTarget")}</span>
          <strong>${targetActor?.name ?? game.i18n.localize("WITCHER.Context.unavailable")}</strong>
        </div>` : ""}
      ${resolutionAction}
    </div>`;

  messageData.flags ??= {};
  messageData.flags.thewitchertrpg ??= {};
  messageData.flags.thewitchertrpg.verbalCombat = damageAction;
  messageData.flags.thewitchertrpg.damage = {
    formula: damageFormula,
    sourceActionKey: damageActionKey,
  };
  messageData.flags.thewitchertrpg.verbalCombatResolution = {
    state: canResolveDamage ? "ready" : "complete",
    sourceAttackMessageId: attackMessage.id,
    attackerActorUuid: sourceAction.actorUuid ?? null,
    defenderActorUuid: defender.uuid,
    attackActionKey: sourceAction.key ?? null,
    defenceActionKey,
    isCounterargue,
    attackTotal,
    defenceTotal,
    defenceSucceeded,
    damageActionKey,
    damageFormula,
    damageTargetActorUuid,
  };
}

async function onResolveVerbalDamage(event) {
  event.preventDefault();

  const button = event.currentTarget;
  const resolutionMessage = game.messages.get(getContextMessageId(button));
  const resolution = resolutionMessage?.getFlag("thewitchertrpg", "verbalCombatResolution");
  if (!resolutionMessage || !resolution?.damageFormula || !resolution.damageTargetActorUuid) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Chat.VerbalResolutionUnavailable"));
  }
  if (resolution.state === "superseded") {
    return ui.notifications.warn(game.i18n.localize("WITCHER.Chat.RerollSuperseded"));
  }

  const targetDocument = fromUuidSync(resolution.damageTargetActorUuid);
  const targetActor = targetDocument?.actor ?? targetDocument;
  if (!targetActor) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Chat.VerbalResolutionUnavailable"));
  }
  if (resolution.state === "applied") {
    return ui.notifications.warn(game.i18n.format("WITCHER.Chat.VerbalDamageAlreadyResolved", { target: targetActor.name }));
  }

  const resolutionKey = resolutionMessage.id;
  if (activeVerbalDamageResolutions.has(resolutionKey) || resolution.state === "rolling") return;
  activeVerbalDamageResolutions.add(resolutionKey);
  button.disabled = true;

  let damageMessage = resolution.damageMessageId
    ? game.messages.get(resolution.damageMessageId)
    : findVerbalDamageMessage(resolutionMessage.id, resolution);

  try {
    await setVerbalDamageResolution(resolutionMessage, { state: "rolling" });
    if (!damageMessage) {
      const damageAction = VerbalCombat.getVerbalAction(resolution.damageActionKey)
        ?? resolutionMessage.getFlag("thewitchertrpg", "verbalCombat");
      damageMessage = await VerbalCombat.rollDamage(damageAction, {
        formula: resolution.damageFormula,
        sourceActionKey: resolution.damageActionKey,
      }, {
        sourceAttackMessageId: resolution.sourceAttackMessageId,
        sourceResolutionMessageId: resolutionMessage.id,
      });
    }

    await setVerbalDamageResolution(resolutionMessage, {
      state: "rolled",
      damageMessageId: damageMessage.id,
    });
    const totalDamage = Number(damageMessage.rolls?.at(-1)?.total);
    const result = await VerbalCombat.applyDamage(targetActor, totalDamage, damageMessage.id);
    if (["applied", "alreadyApplied"].includes(result?.status)) {
      await setVerbalDamageResolution(resolutionMessage, {
        state: "applied",
        damageMessageId: damageMessage.id,
        appliedAt: Date.now(),
      });
    }
  } catch (error) {
    console.error("TheWitcherTRPG | Failed to resolve verbal combat damage.", error);
    await setVerbalDamageResolution(resolutionMessage, {
      state: damageMessage ? "rolled" : "ready",
      damageMessageId: damageMessage?.id ?? null,
    });
    ui.notifications.error(game.i18n.localize("WITCHER.Chat.VerbalResolutionFailed"));
  } finally {
    activeVerbalDamageResolutions.delete(resolutionKey);
    const finalState = resolutionMessage.getFlag("thewitchertrpg", "verbalCombatResolution")?.state;
    button.disabled = ["rolling", "applied"].includes(finalState);
  }
}

async function setVerbalDamageResolution(message, update) {
  const current = message.getFlag("thewitchertrpg", "verbalCombatResolution") ?? {};
  await message.setFlag("thewitchertrpg", "verbalCombatResolution", {
    ...current,
    ...update,
  });
}

function findVerbalDamageMessage(resolutionMessageId, resolution) {
  const messages = game.messages?.contents ?? Array.from(game.messages ?? []);
  return [...messages].reverse().find(message => {
    const damage = message.getFlag?.("thewitchertrpg", "damage");
    const link = damage?.verbalCombatLink;
    if (link?.sourceResolutionMessageId === resolutionMessageId) return true;

    return !resolution.defenceSucceeded
      && !link?.sourceResolutionMessageId
      && link?.sourceAttackMessageId === resolution.sourceAttackMessageId
      && (link?.sourceActionKey ?? damage?.sourceActionKey) === resolution.damageActionKey
      && damage?.formula === resolution.damageFormula;
  }) ?? null;
}

function findVerbalDefenceMessage(sourceAttackMessageId, defenderActorUuid) {
  const messages = game.messages?.contents ?? Array.from(game.messages ?? []);
  return [...messages].reverse().find(message => {
    const resolution = message.getFlag?.("thewitchertrpg", "verbalCombatResolution");
    return resolution?.sourceAttackMessageId === sourceAttackMessageId
      && resolution?.defenderActorUuid === defenderActorUuid;
  }) ?? null;
}

/*
  Button Dialog
    Send an array of buttons to create a dialog that will execute specific callbacks based on button pressed.

    returns a promise (no value)

  data = {
    buttons : [[`Label`, ()=>{Callback} ], ...]
    title : `title_label`,
    content : `Html_Content`
  }
*/
export async function buttonDialog(data) {
  return await new Promise(async (resolve) => {
    let buttons = {}, dialog;

    data.buttons.forEach(([str, callback]) => {
      buttons[str] = {
        label: str,
        callback
      }
    });

    dialog = new WitcherDialog({
      title: data.title,
      content: data.content,
      buttons,
      close: () => resolve()
    }, {
      width: 300,
    });

    await renderApplication(dialog);
  });
}

async function onShield(event) {
  const shieldFormula = event.currentTarget.getAttribute("data-shield") ?? "0";
  const actorUuid = event.currentTarget.getAttribute("data-actor");
  const actor = fromUuidSync(actorUuid);
  if (!actor) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Context.SelectActor"));
  }

  const shield = await evaluateFormula(shieldFormula);
  if (shield === null) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Context.InvalidFormula"));
  }

  await actor.update({ 'system.derivedStats.shield.value': shield });

  let messageContent = `${actor.name} ${game.i18n.localize("WITCHER.Combat.shieldApplied")} ${shield}`;
  let messageData = {
    user: game.user.id,
    content: messageContent,
    speaker: ChatMessage.getSpeaker({ actor: actor }),
  }
  await ChatMessage.create(messageData);
}

async function onHeal(event) {
  const healFormula = event.currentTarget.getAttribute("data-heal") ?? "0";
  const actorUuid = event.currentTarget.getAttribute("data-actor");
  const actor = fromUuidSync(actorUuid);
  const targetedToken = game.user.targets?.values?.().next?.().value;
  const target = targetedToken?.actor ?? canvas.tokens?.controlled?.[0]?.actor ?? game.user.character;
  if (!actor || !target) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Context.SelectActor"));
  }

  const rolledHeal = await evaluateFormula(healFormula);
  if (rolledHeal === null) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Context.InvalidFormula"));
  }

  const currentHp = Number(target.system.derivedStats.hp.value);
  const maxHp = Number(target.system.derivedStats.hp.max);
  if (!Number.isFinite(currentHp) || !Number.isFinite(maxHp)) {
    return ui.notifications.error(game.i18n.localize("WITCHER.Context.InvalidActorState"));
  }
  const heal = Math.min(rolledHeal, Math.max(0, maxHp - currentHp));
  await target.update({ 'system.derivedStats.hp.value': currentHp + heal });

  let messageContent = `${actor.name} ${game.i18n.format("WITCHER.Combat.healed", { heal: heal, target: target.name })}`;
  let messageData = {
    user: game.user.id,
    content: messageContent,
    speaker: ChatMessage.getSpeaker({ actor: actor }),
  }
  await ChatMessage.create(messageData);
}

/**
 * @param {string} rollFormula rollFormula to apply
 * @param {*} messageData messageData to display
 * @param {RollConfig} config Configuration for Extended roll
 * @param {Flag} flags an object/array of objects of flags to be set
 */
export async function extendedRoll(rollFormula, messageData, config, flags) {
  const baseFlavor = String(messageData?.flavor ?? "");
  let roll = await new Roll(rollFormula).evaluate()
  let rollTotal = Number(roll.total);
  let defenceResolution = null;
  let success = null;

  //crit/fumble calculation
  if (config.showCrit && (isCrit(roll) || isFumble(roll))) {
    let extraRollDescription = isCrit(roll) ? `${game.i18n.localize("WITCHER.Crit")}` : `${game.i18n.localize("WITCHER.Fumble")}`;

    let critClass = config.reversal ? "dice-fail" : "dice-success"
    let fumbleClass = config.reversal ? "dice-success" : "dice-fail"
    messageData.flavor += isCrit(roll)
      ? `<div class="${critClass}"><i class="fas fa-dice-d6"></i>${game.i18n.localize("WITCHER.Crit")}</div>`
      : `<div class="${fumbleClass}"><i class="fas fa-dice-d6"></i>${game.i18n.localize("WITCHER.Fumble")}</div>`;

    messageData.flavor += `<div>${rollFormula} = <b>${rollTotal}</b></div>`;

    //print crit/fumble roll
    let extraRollFormula = `1d10x10[${extraRollDescription}]`;
    let extraRoll = await new Roll(extraRollFormula).evaluate();
    let extraRollTotal = Number(extraRoll.total);
    messageData.flavor += `<div>${extraRollFormula} = <b>${extraRollTotal}</b></div>`;

    //add/subtract extra result from the original one
    extraRollFormula = `${rollTotal}[${game.i18n.localize("WITCHER.BeforeCrit")}]`;
    if (isCrit(roll)) {
      extraRollFormula += `+${extraRollTotal}[${extraRollDescription}]`;
      rollTotal += extraRollTotal;
    } else {
      if (extraRollTotal >= rollTotal) {
        extraRollTotal = rollTotal;
      }
      extraRollFormula += `-${extraRollTotal}[${extraRollDescription}]`;
      rollTotal -= extraRollTotal;
    }

    //print add/subtract roll info
    extraRoll = await new Roll(extraRollFormula).evaluate();
    roll = extraRoll;
  }

  //calculate overall success/failure for the attack/defence
  const threshold = Number(config.threshold);
  if (Number.isFinite(threshold) && threshold >= 0) {
    const defenderWinsTies = config.defence || config.opposedDefence;
    const tiesSucceed = defenderWinsTies || config.tiesSucceed;
    if (!config.reversal) {
      success = tiesSucceed ? roll.total >= threshold : roll.total > threshold
    } else {
      success = tiesSucceed ? roll.total <= threshold : roll.total < threshold
    }
  }

  if (config.showSuccess && success !== null) {
    let successHeader = config.thresholdDesc ? `: ${game.i18n.localize(config.thresholdDesc)}` : ""
    const resultMessage = success ? config.messageOnSuccess : config.messageOnFailure;
    messageData.flavor += success
      ? `<div class="dice-success"><i>${game.i18n.localize("WITCHER.Chat.Success")}${successHeader}</i>${resultMessage ? `<br>${resultMessage}` : ""}</div>`
      : `<div class="dice-fail"><i>${game.i18n.localize("WITCHER.Chat.Fail")}${successHeader}</i>${resultMessage ? `<br>${resultMessage}` : ""}</div>`;

    messageData.flags = cloneData(success
      ? config.flagsOnSuccess
      : config.flagsOnFailure);
  }

  if (config.defence && Number.isFinite(threshold) && threshold >= 0) {
    defenceResolution = await appendDefenceResolution(messageData, threshold, Number(roll.total), config);
    if (!messageData.flags || typeof messageData.flags !== "object") {
      messageData.flags = {};
    }
    messageData.flags.thewitchertrpg ??= {};
    messageData.flags.thewitchertrpg.defenceResolution = {
      attackTotal: threshold,
      defenceTotal: Number(roll.total),
      margin: defenceResolution.margin,
      criticalWound: defenceResolution.criticalWound?.key ?? null,
      bonusDamage: defenceResolution.criticalWound?.bonusDamage ?? 0,
      hitLocation: config.hitLocation || null,
      criticalLocation: defenceResolution.criticalLocation,
      criticalResult: defenceResolution.criticalResult,
      sourceAttackMessageId: config.sourceAttackMessageId ?? null,
      targetActorUuid: config.targetActorUuid ?? null,
      targetTokenUuid: config.targetTokenUuid ?? null,
    };
    if (defenceResolution.margin > 0
      && config.sourceAttackMessageId
      && config.targetActorUuid
      && hasResolvableDamage(config.sourceAttackMessageId)) {
      messageData.flags.thewitchertrpg.damageResolution = {
        state: "ready",
        targetActorUuid: config.targetActorUuid,
      };
    }
  }

  if (typeof config.onResolved === "function") {
    await config.onResolved({
      messageData,
      roll,
      total: Number(roll.total),
      threshold,
      success,
    });
  }

  const rerollFlag = createRollRerollFlag({
    formula: rollFormula,
    baseFlavor,
    config,
    success,
  });
  if (rerollFlag) {
    if (!messageData.flags || typeof messageData.flags !== "object" || Array.isArray(messageData.flags)) {
      messageData.flags = {};
    }
    messageData.flags.thewitchertrpg ??= {};
    messageData.flags.thewitchertrpg.rollReroll = rerollFlag;
    messageData.flavor += renderRollRerollAction(rerollFlag);
  }

  let message = null;
  if (config.showResult) {
    message = await roll.toMessage(messageData)
    if (flags) {
      if (Array.isArray(flags)) {
        await Promise.all(flags.map(flag => message.setFlag('thewitchertrpg', flag.key, flag.value)))
      }
      else {
        await message.setFlag('thewitchertrpg', flags.key, flags.value)
      }
    }

  }

  if (config.returnMessage) return message;
  return config.showResult ? roll.total : roll
}

function renderRollRerollAction(reroll) {
  const history = reroll.count > 0 ? `<span>${game.i18n.format("WITCHER.Chat.RerollNumber", {
    count: reroll.count,
  })}</span>` : "";
  const label = reroll.count > 0
    ? game.i18n.localize("WITCHER.Chat.RerollAgain")
    : game.i18n.localize("WITCHER.Chat.Reroll");
  return `<div class="roll-reroll-actions">
    ${history}
    <button type="button" class="roll-reroll">
      <i class="fas fa-redo-alt" aria-hidden="true"></i><span>${label}</span>
    </button>
  </div>`;
}

async function appendDefenceResolution(messageData, attackTotal, defenceTotal, config) {
  const hitLocation = config.hitLocation;
  const margin = attackTotal - defenceTotal;
  const attackLanded = margin > 0;
  const sourceAttackMessage = config.sourceAttackMessageId
    ? game.messages?.get(config.sourceAttackMessageId)
    : null;
  const sourceItem = sourceAttackMessage?.getFlag("thewitchertrpg", "spell")
    ?? sourceAttackMessage?.getFlag("thewitchertrpg", "item")
    ?? null;
  const sourceAttackHasDamage = config.sourceAttackMessageId
    ? hasResolvableDamage(config.sourceAttackMessageId)
    : false;
  const canCauseCriticalWound = shouldResolveAttackCriticalWound({
    isSpell: Boolean(sourceAttackMessage?.getFlag("thewitchertrpg", "spell") || sourceItem?.type === "spell"),
    hasDamage: sourceAttackHasDamage,
  });
  const criticalWound = canCauseCriticalWound ? getCriticalWound(margin) : null;
  const criticalLocation = criticalWound ? getCriticalWoundLocation(hitLocation) : null;
  const criticalDraw = criticalWound
    ? await drawCriticalWound(criticalWound, hitLocation, { displayChat: false })
    : null;
  const criticalResult = criticalDraw?.criticalResult ?? null;
  const criticalLabel = criticalWound
    ? game.i18n.localize(`WITCHER.CritWound.${criticalWound.key}`)
    : game.i18n.localize("WITCHER.CritWound.None");
  const bonusDamage = criticalWound
    ? game.i18n.format("WITCHER.Chat.CriticalBonusDamage", { damage: criticalWound.bonusDamage })
    : "";
  const criticalResultName = criticalResult?.effect
    ? game.i18n.localize(`WITCHER.CritWound.Name.${criticalResult.effect}`)
    : game.i18n.localize("WITCHER.Chat.CriticalResultUnavailable");
  const criticalDescription = criticalResult?.effect
    ? game.i18n.localize(`WITCHER.CritWound.${criticalResult.effect}`)
    : "";
  const criticalEffect = criticalResult?.effect
    ? game.i18n.localize(`WITCHER.CritWound.Mod.${criticalResult.effect}.None`)
    : "";
  const canResolveDamage = sourceAttackHasDamage
    && !config.targetTokenUuid
    && attackLanded
    && config.sourceAttackMessageId
    && config.targetActorUuid;
  const resolutionActions = canResolveDamage ? `
      <div class="defence-resolution-actions">
        <button type="button" class="resolve-damage" data-derived-stat="hp">
          <i class="fas fa-heart-broken" aria-hidden="true"></i>
          <span>${game.i18n.localize("WITCHER.Chat.ResolveDamage")}</span>
        </button>
        <button type="button" class="resolve-damage secondary" data-derived-stat="sta">
          <i class="fas fa-bolt" aria-hidden="true"></i>
          <span>${game.i18n.localize("WITCHER.Chat.ResolveNonLethal")}</span>
        </button>
      </div>` : "";

  messageData.flavor += `
    <div class="defence-resolution ${attackLanded ? "is-hit" : "is-defended"}">
      <div class="defence-resolution-result">
        <i class="fas ${attackLanded ? "fa-crosshairs" : "fa-shield-alt"}" aria-hidden="true"></i>
        <strong>${game.i18n.localize(attackLanded ? "WITCHER.Chat.AttackLanded" : "WITCHER.Chat.AttackDefended")}</strong>
      </div>
      <div class="defence-resolution-line"><span>${game.i18n.localize("WITCHER.Chat.AttackTotal")}</span><strong>${attackTotal}</strong></div>
      <div class="defence-resolution-line"><span>${game.i18n.localize("WITCHER.Chat.DefenceTotal")}</span><strong>${defenceTotal}</strong></div>
      <div class="defence-resolution-line"><span>${game.i18n.localize("WITCHER.Chat.AttackMargin")}</span><strong>${margin}</strong></div>
      ${canCauseCriticalWound ? `<div class="defence-resolution-critical${criticalWound ? " dice-fail" : ""}">
        <span>${game.i18n.localize("WITCHER.Chat.CriticalWound")}</span>
        <strong>${criticalLabel}${bonusDamage ? ` (${bonusDamage})` : ""}</strong>
      </div>` : ""}
      ${criticalWound && criticalLocation ? `
        <div class="defence-resolution-line">
          <span>${game.i18n.localize("WITCHER.Chat.CriticalLocationLabel")}</span>
          <strong>${game.i18n.localize(`WITCHER.Chat.CriticalLocation.${criticalLocation}`)}</strong>
        </div>` : ""}
      ${criticalWound ? `
        <div class="defence-resolution-critical-detail${criticalResult ? "" : " is-unavailable"}">
          <div class="defence-resolution-critical-name">
            <span>${game.i18n.localize("WITCHER.Chat.CriticalResult")}</span>
            <strong>${criticalResultName}</strong>
          </div>
          ${criticalDescription ? `<p>${criticalDescription}</p>` : ""}
          ${criticalEffect ? `
            <p class="defence-resolution-critical-effect">
              <strong>${game.i18n.localize("WITCHER.Chat.CriticalEffect")}</strong>
              <span>${criticalEffect}</span>
            </p>` : ""}
        </div>` : ""}
      ${resolutionActions}
    </div>`;

  return { margin, criticalWound, criticalLocation, criticalResult };
}

function hasResolvableDamage(attackMessageId) {
  const attackMessage = game.messages?.get(attackMessageId);
  if (!attackMessage?.getFlag("thewitchertrpg", "damage")) return false;

  return Boolean(
    attackMessage.getFlag("thewitchertrpg", "attack")?.item
    ?? attackMessage.getFlag("thewitchertrpg", "item")
    ?? attackMessage.getFlag("thewitchertrpg", "spell")
  );
}

async function evaluateFormula(formula) {
  try {
    const roll = await new Roll(String(formula ?? "0")).evaluate();
    const total = Number(roll.total);
    return Number.isFinite(total) ? Math.max(0, total) : null;
  } catch (error) {
    console.warn("TheWitcherTRPG | Invalid roll formula.", { formula, error });
    return null;
  }
}

function isCrit(roll) {
  return roll.dice[0].results[0].result == 10;
}

function isFumble(roll) {
  return roll.dice[0].results[0].result == 1;
}

export function addChatMessageContextOptions(html, options) {
  const attackMessage = game.i18n.localize("WITCHER.Context.Defense");
  if (options.some(option => (option.label ?? option.name) === attackMessage)) {
    return options;
  }

  let canDefend = li => Boolean(getContextElement(li)?.querySelector(".attack-message"))
  let canApplyDamage = li => Boolean(getContextElement(li)?.querySelector(".damage-message"))
  let canApplyVcDamage = li => Boolean(getContextElement(li)?.querySelector(".verbalcombat-damage-message"))

  options.push(
    {
      label: `${game.i18n.localize("WITCHER.Context.applyDmg")}`,
      icon: '<i class="fas fa-user-minus"></i>',
      visible: canApplyDamage,
      onClick: (event, target) => {
        const li = resolveContextEntry(".damage-message", target, event);
        const actor = getInteractActor();
        if (!actor) return;
        ApplyNormalDamage(
          actor,
          getContextText(li, ".dice-total"),
          getContextMessageId(li)
        )
      }
    },
    {
      label: `${game.i18n.localize("WITCHER.Context.applyNonLethal")}`,
      icon: '<i class="fas fa-user-minus"></i>',
      visible: canApplyDamage,
      onClick: (event, target) => {
        const li = resolveContextEntry(".damage-message", target, event);
        const actor = getInteractActor();
        if (!actor) return;
        ApplyNonLethalDamage(
          actor,
          getContextText(li, ".dice-total"),
          getContextMessageId(li)
        )
      }
    },
    {
      label: attackMessage,
      icon: '<i class="fas fa-shield-alt"></i>',
      visible: canDefend,
      onClick: (event, target) => {
        const li = resolveContextEntry(".attack-message", target, event);
        const actor = getInteractActor();
        if (!actor) return;
        const attackElement = getContextElement(li)?.querySelector(".attack-message");
        ExecuteDefence(
          actor,
          attackElement?.dataset.dmgType,
          getContextAttackLocation(li, attackElement),
          getContextRollTotal(li, attackElement),
          getContextMessageId(li),
          attackElement?.dataset.defence)
      }
    },
    {
      label: `${game.i18n.localize("WITCHER.Context.applyDmg")}`,
      icon: '<i class="fas fa-user-minus"></i>',
      visible: canApplyVcDamage,
      onClick: (event, target) => {
        const li = resolveContextEntry(".verbalcombat-damage-message", target, event);
        const actor = getInteractActor();
        if (!actor) return;
        VerbalCombat.applyDamage(
          actor,
          getContextText(li, ".dice-total"),
          getContextMessageId(li)
        )
      }
    }
  );
  return options;
}

function resolveContextEntry(selector, ...entries) {
  return entries.find(entry => getContextElement(entry)?.querySelector?.(selector))
    ?? entries.find(entry => getContextElement(entry))
    ?? null;
}

function getContextElement(entry) {
  const element = normalizeContextElement(entry);
  return element?.closest?.(".chat-message") ?? element;
}

function normalizeContextElement(entry) {
  if (!entry) {
    return null;
  }

  if (entry instanceof Element) {
    return entry;
  }

  if (entry.jquery) {
    return normalizeContextElement(entry[0]);
  }

  if (Array.isArray(entry) || entry instanceof NodeList || entry instanceof HTMLCollection) {
    return normalizeContextElement(entry[0]);
  }

  if (typeof entry.querySelector === "function") {
    return entry;
  }

  return normalizeContextElement(entry.currentTarget ?? entry.target ?? entry.element ?? entry[0]);
}

function getContextText(entry, selector) {
  const element = getContextElement(entry);
  if (!element || typeof element.querySelector !== "function") {
    return undefined;
  }

  return element.querySelector(selector)?.textContent?.trim();
}

function cloneData(value) {
  if (value === undefined) return undefined;
  return globalThis.foundry?.utils?.deepClone?.(value)
    ?? JSON.parse(JSON.stringify(value));
}

function getContextMessageId(entry) {
  const element = getContextElement(entry);
  return element?.dataset?.messageId
    ?? element?.dataset?.messageid
    ?? element?.dataset?.message
    ?? element?.id?.replace(/^chat-message-/, "");
}

function getContextRollTotal(entry, attackElement = null) {
  const attackElementTotal = Number(attackElement?.dataset?.attackTotal);
  if (Number.isFinite(attackElementTotal)) {
    return attackElementTotal;
  }

  const message = game.messages?.get(getContextMessageId(entry));
  const flagTotal = Number(message?.getFlag?.("thewitchertrpg", "attackTotal"));
  if (Number.isFinite(flagTotal)) {
    return flagTotal;
  }

  const messageRollTotal = Number(message?.rolls?.at(-1)?.total);
  if (Number.isFinite(messageRollTotal)) {
    return messageRollTotal;
  }

  const element = getContextElement(entry);
  const diceTotals = element ? Array.from(element.querySelectorAll(".dice-total")) : [];
  const textTotal = Number(diceTotals.at(-1)?.textContent?.trim() ?? getContextText(entry, ".dice-total"));
  if (Number.isFinite(textTotal)) {
    return textTotal;
  }

  console.warn("TheWitcherTRPG | Could not determine attack total for defence roll.", { entry, message });
  return undefined;
}

function getContextAttackLocation(entry, attackElement = null) {
  if (attackElement?.dataset?.location) {
    return attackElement.dataset.location;
  }

  const message = game.messages?.get(getContextMessageId(entry));
  return message?.getFlag?.("thewitchertrpg", "attackLocation")
    ?? message?.getFlag?.("thewitchertrpg", "damage")?.location?.name
    ?? null;
}

function getInteractActor() {
  const controlledTokens = canvas.tokens?.controlled ?? [];
  let actor = controlledTokens[0]?.actor ?? game.user.character
  if (!actor) {
    ui.notifications.error(game.i18n.localize("WITCHER.Context.SelectActor"));
    return null;
  }

  return actor;
}
