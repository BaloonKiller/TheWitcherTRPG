import { WITCHER } from "../setup/config.js";
import { addModifiers } from "./witcher.js";
import { buildVerbalDamageResourceUpdate } from "./verbalCombatDamage.mjs";

export const VERBAL_ATTACK_ACTIONS = Object.freeze([
    "Seduce",
    "Persuade",
    "Appeal",
    "Befriend",
    "Deceive",
    "Ridicule",
    "Intimidate",
]);

export const VERBAL_DEFENCE_ACTIONS = Object.freeze([
    "Ignore",
    "Counterargue",
    "ChangeSubject",
    "Disengage",
]);

const activeDamageRolls = new Set();
const activeDamageApplications = new Set();

export function getVerbalActionType(actionKey) {
    if (VERBAL_ATTACK_ACTIONS.includes(actionKey)) return "attack";
    if (VERBAL_DEFENCE_ACTIONS.includes(actionKey)) return "defence";
    return "tool";
}

export function getVerbalAction(actionKey) {
    return WITCHER.verbalCombat[actionKey] ?? null;
}

export function buildVerbalDamageFormula(actor, actionKey, customModifier = 0) {
    const action = getVerbalAction(actionKey);
    if (!actor || !action?.baseDmg || !action?.dmgStat?.name) return null;

    const damageStat = Number(actor.system.stats?.[action.dmgStat.name]?.current) || 0;
    const damageLabel = game.i18n.localize(action.dmgStat.label);
    let formula = `${action.baseDmg}+${damageStat}[${damageLabel}]`;
    const modifier = Number(customModifier);
    if (Number.isFinite(modifier) && modifier !== 0) {
        const sign = modifier > 0 ? "+" : "";
        formula += `${sign}${modifier}[${game.i18n.localize("WITCHER.Chat.VerbalDamageModifier")}]`;
    }
    return formula;
}

export function buildVerbalRollData(actor, actionKey, customModifier = 0, customDamageModifier = 0) {
    const action = getVerbalAction(actionKey);
    if (!actor || !action?.skill) return null;

    const displayRollDetails = game.settings.get("thewitchertrpg", "displayRollsDetails");
    const attributeName = action.skill.attribute.name;
    const skillName = action.skill.name;
    const statValue = Number(actor.system.stats?.[attributeName]?.current) || 0;
    const skillData = actor.system.skills?.[attributeName]?.[skillName];
    const skillValue = Number(skillData?.value) || 0;
    const statLabel = game.i18n.localize(action.skill.attribute.label);
    const skillLabel = game.i18n.localize(action.skill.label);

    let formula = displayRollDetails
        ? `1d10+${statValue}[${statLabel}]+${skillValue}[${skillLabel}]`
        : `1d10+${statValue}+${skillValue}`;
    formula = addModifiers(skillData?.modifiers, formula);

    const modifier = Number(customModifier);
    if (Number.isFinite(modifier) && modifier !== 0) {
        const sign = modifier > 0 ? "+" : "";
        formula += displayRollDetails
            ? `${sign}${modifier}[${game.i18n.localize("WITCHER.Settings.Custom")}]`
            : `${sign}${modifier}`;
    }

    return {
        action,
        actionKey,
        actionType: getVerbalActionType(actionKey),
        damageFormula: buildVerbalDamageFormula(actor, actionKey, customDamageModifier),
        formula,
    };
}

export function createVerbalActionFlags(actor, actionKey, damageFormula) {
    const action = getVerbalAction(actionKey);
    return [
        {
            key: "verbalCombat",
            value: action,
        },
        {
            key: "damage",
            value: {
                formula: damageFormula,
                sourceActionKey: actionKey,
            },
        },
        {
            key: "verbalCombatAction",
            value: {
                actorUuid: actor?.uuid ?? null,
                key: actionKey,
                type: getVerbalActionType(actionKey),
            },
        },
    ];
}

export function addVerbalCombatChatListeners(html) {
    html = $(html);

    html.find(".chat-message").each(async (index, element) => {
        element = $(element);
        const id = element.data("messageId");
        const message = game.messages?.get(id);
        if (!message) return;

        await chatMessageListeners(message, element);
    });
}

export const chatMessageListeners = async (message, html) => {
    html = $(html);
    const resolution = message.getFlag("thewitchertrpg", "verbalCombatResolution");
    if (["rolling", "applied", "superseded"].includes(resolution?.state)) {
        html.find("button.resolve-verbal-damage").prop("disabled", true);
    }

    const damageButtons = html.find("button.vcDamage");
    if (!damageButtons.length) return;

    damageButtons
        .off("click.thewitchertrpgVerbal")
        .on("click.thewitchertrpgVerbal", event => onDamage(message, event));
};

async function onDamage(message, event) {
    event.preventDefault();
    if (activeDamageRolls.has(message.id)) return;

    const button = event.currentTarget;
    const verbalCombat = message.getFlag("thewitchertrpg", "verbalCombat");
    const damage = message.getFlag("thewitchertrpg", "damage");
    const action = message.getFlag("thewitchertrpg", "verbalCombatAction");
    if (!verbalCombat || !damage?.formula) {
        return ui.notifications.error(game.i18n.localize("WITCHER.Chat.VerbalResolutionUnavailable"));
    }

    activeDamageRolls.add(message.id);
    button.disabled = true;
    try {
        await rollDamage(verbalCombat, damage, {
            sourceActionKey: action?.key ?? damage.sourceActionKey ?? null,
            sourceAttackMessageId: message.id,
        });
    } catch (error) {
        console.error("TheWitcherTRPG | Failed to roll verbal combat damage.", error);
        ui.notifications.error(game.i18n.localize("WITCHER.Chat.VerbalResolutionFailed"));
    } finally {
        activeDamageRolls.delete(message.id);
        button.disabled = false;
    }
}

export async function rollDamage(verbalCombat, damage, linkage = {}) {
    if (!damage?.formula) {
        throw new Error("Verbal combat damage formula is unavailable.");
    }

    const messageData = {
        flavor: `<div class="verbalcombat-damage-message"><h1>${game.i18n.localize("WITCHER.table.Damage")}: ${game.i18n.localize(verbalCombat.name)}</h1></div>`,
    };
    const roll = await new Roll(damage.formula).evaluate();
    const message = await roll.toMessage(messageData);
    await message.setFlag("thewitchertrpg", "damage", {
        ...damage,
        verbalCombatLink: linkage,
    });
    await message.setFlag("thewitchertrpg", "verbalCombat", verbalCombat);
    return message;
}

export async function applyDamage(targetActor, totalDamage, messageId) {
    const resourceUpdate = buildVerbalDamageResourceUpdate(
        targetActor?.system.derivedStats.resolve.value,
        totalDamage,
    );
    const message = game.messages?.get(messageId);
    if (!targetActor || !message || !resourceUpdate) {
        return ui.notifications.error(game.i18n.localize("WITCHER.Context.InvalidActorState"));
    }

    const actorUuid = targetActor.uuid ?? targetActor.id;
    const storedApplications = message.getFlag("thewitchertrpg", "damageApplications");
    const applications = Array.isArray(storedApplications) ? storedApplications : [];
    const existingApplication = applications.find(application => application.actorUuid === actorUuid);
    if (existingApplication) {
        ui.notifications.warn(game.i18n.format("WITCHER.Chat.VerbalDamageAlreadyResolved", { target: targetActor.name }));
        return { status: "alreadyApplied", application: existingApplication };
    }

    const applicationKey = `${messageId}:${actorUuid}`;
    if (activeDamageApplications.has(applicationKey)) return { status: "busy" };
    activeDamageApplications.add(applicationKey);

    try {
        await targetActor.update(resourceUpdate.updates);

        const defeated = resourceUpdate.defeated;
        let resultMessage = null;
        try {
            resultMessage = await ChatMessage.create({
                user: game.user.id,
                speaker: ChatMessage.getSpeaker({ actor: targetActor }),
                content: `
                    <div class="verbalcombat-application ${defeated ? "is-defeated" : ""}">
                        <strong>${game.i18n.localize(defeated ? "WITCHER.Chat.VerbalCombatLost" : "WITCHER.Chat.VerbalDamageResolved")}</strong>
                        <div>${game.i18n.format("WITCHER.Chat.VerbalResolveChange", {
                            target: targetActor.name,
                            before: resourceUpdate.resolveBefore,
                            after: resourceUpdate.remainingResolve,
                            damage: resourceUpdate.appliedDamage,
                        })}</div>
                    </div>`,
            });
        } catch (error) {
            console.warn("TheWitcherTRPG | Resolve was updated, but its result message could not be created.", error);
        }
        const application = {
            actorUuid,
            appliedAt: Date.now(),
            damage: resourceUpdate.rolledDamage,
            appliedDamage: resourceUpdate.appliedDamage,
            resultMessageId: resultMessage?.id ?? null,
            userId: game.user.id,
        };

        try {
            await message.setFlag("thewitchertrpg", "damageApplications", [...applications, application]);
        } catch (error) {
            console.warn("TheWitcherTRPG | Verbal damage was applied, but its message could not be marked as resolved.", error);
        }

        return { status: "applied", application };
    } finally {
        activeDamageApplications.delete(applicationKey);
    }
}
