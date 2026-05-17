import { getCurrentToken } from "./helper.js";
import { getRandomInt } from "./witcher.js";

export function addAttackChatListeners(html) {
    html = $(html);

    // setup chat listener messages for each message as some need the message context instead of chatlog context.
    html.find('.chat-message').each(async (index, element) => {
        element = $(element);
        const id = element.data('messageId');
        const message = game.messages?.get(id);
        if (!message) return;

        await chatMessageListeners(message, element)
    });
}

export const chatMessageListeners = async (message, html) => {
    html = $(html);

    if (!html.find('button.damage') && !!html.find('a.apply-status'))
        return;

    html.find('button.damage').on('click', event => onDamage(message, event));
    html.find('a.apply-status').on('click', event => onApplyStatus(event));
}

function onDamage(message, event) {
    let item = message.getFlag('thewitchertrpg', 'attack')?.item
        ?? message.getFlag('thewitchertrpg', 'item')
        ?? message.getFlag('thewitchertrpg', 'spell')
        ?? itemFromDamageButton(event?.currentTarget);
    let damage = message.getFlag('thewitchertrpg', 'damage') ?? damageFromButton(event?.currentTarget);

    if (!item || !damage) {
        ui.notifications.error(game.i18n.localize("WITCHER.NoDamageSpecified"));
        return;
    }

    if (damage.location?.name == "randomSpell") {
        let actor = game.actors.get(message.speaker.actor) || game.actors.contents?.[0];
        damage.location = actor?.getLocationObject("randomHuman") ?? damage.location;
    }
    rollDamage(item, damage);
}

export async function rollDamage(item, damage) {
    let damageOptions = {
        armorPiercing: item.system?.armorPiercing || damage.ammunition?.system.armorPiercing,
        improvedArmorPiercing: item.system?.improvedArmorPiercing || damage.ammunition?.system.improvedArmorPiercing,
        ablating: item.system?.ablating || damage.ammunition?.system.ablating,
        ignoreArmor: Boolean(item.system?.ignoreArmor || damage.ignoreArmor)
    }

    let messageData = {}
    messageData.flavor = `<div class="damage-message" <h1><img src="${item.img}" class="item-img" />${game.i18n.localize("WITCHER.table.Damage")}: ${item.name} </h1>`;

    damage.formula = normalizeDamageFormula(damage.formula);

    if (damage.formula == "") {
        damage.formula = "0"
        ui.notifications.error(`${game.i18n.localize("WITCHER.NoDamageSpecified")}`)
    }

    if (damage.strike == "strong") {
        damage.formula = `(${damage.formula})*2`;
        messageData.flavor += `<div>${game.i18n.localize("WITCHER.Dialog.strikeStrong")}</div>`;
    }
    messageData.flavor += `<div><b>${game.i18n.localize("WITCHER.Dialog.attackLocation")}:</b> ${damage.location.alias} = ${damage.location.locationFormula} </div>`;
    let damageTypeloc = damage.type ? "WITCHER.Armor." + damage.type : ""
    messageData.flavor += `<div><b>${game.i18n.localize("WITCHER.Dialog.damageType")}:</b> ${game.i18n.localize(damageTypeloc)} </div>`;
    messageData.flavor += `<div>${damageOptions.ignoreArmor ? game.i18n.localize("WITCHER.Damage.ignoreArmor") : game.i18n.localize("WITCHER.Damage.RemoveSP")}</div>`;

    if (damage.effects && damage.effects.length > 0) {
        messageData.flavor += `<b>${game.i18n.localize("WITCHER.Item.Effect")}:</b>`;

        damage.effects.forEach(effect => {
            messageData.flavor += `<div class="flex gap">`;
            if (effect.name != '') {
                messageData.flavor += `<span>${effect.name}</span>`;
            }
            if (effect.statusEffect) {
                let statusEffect = CONFIG.WITCHER.statusEffects.find(status => status.id == effect.statusEffect);
                messageData.flavor += `<a class='apply-status' data-status='${effect.statusEffect}' ><img class='chat-icon' src='${statusEffect.img}' /> <span>${game.i18n.localize(statusEffect.name)}</span></a>`;
            }
            if (effect.percentage) {
                let rollPercentage = getRandomInt(100);
                messageData.flavor += `<div data-tooltip='${game.i18n.localize("WITCHER.Effect.Rolled")}: ${rollPercentage}'>(${effect.percentage}%) `;
                if (rollPercentage > effect.percentage) {
                    messageData.flavor += `<span class="percentageFailed">${game.i18n.localize("WITCHER.Effect.Failed")}</span>`
                }
                else {
                    messageData.flavor += `<span class="percentageSuccess">${game.i18n.localize("WITCHER.Effect.Applied")}</span>`;
                }
                messageData.flavor += '</div>'
            }

            messageData.flavor += `</div>`;
        });
    }

    let message = await (await new Roll(damage.formula).evaluate()).toMessage(messageData)
    message.setFlag('thewitchertrpg', 'damageOptions', damageOptions)
    message.setFlag('thewitchertrpg', 'damage', damage);
}

function itemFromDamageButton(button) {
    if (!button) return null;

    return {
        name: button.dataset.name ?? game.i18n.localize("WITCHER.table.Damage"),
        img: button.dataset.img ?? "icons/svg/explosion.svg",
        system: {}
    };
}

function damageFromButton(button) {
    if (!button) return null;

    return {
        formula: button.dataset.dmg ?? "0",
        location: parseJsonDataset(button.dataset.location) ?? {},
        effects: parseJsonDataset(button.dataset.effects) ?? [],
        type: button.dataset.dmgType ?? button.dataset.type ?? "",
        ignoreArmor: button.dataset.ignoreArmor === "true"
    };
}

function parseJsonDataset(value) {
    if (!value) return null;

    try {
        return JSON.parse(value);
    } catch (error) {
        console.warn("TheWitcherTRPG | Could not parse damage button data.", error);
        return null;
    }
}

function normalizeDamageFormula(formula) {
    return String(formula ?? "")
        .trim()
        .replace(/\*+$/g, "")
        .trim();
}


async function onApplyStatus(event) {
    let statusId = event.currentTarget.dataset.status
    let target = getCurrentToken();
    let actor = target?.actor;

    if (!actor) {
        ui.notifications.warn("Select a token before applying a status effect.");
        return;
    }

    //only try to apply it when not already present
    if (!actor.statuses.has(statusId)) {
        await actor.toggleStatusEffect(statusId, { active: true })

        if (actor.system.statusEffectImmunities?.find(immunity => immunity == statusId)) {
            //untoggle it so people see it was tried to be applied but failed
            setTimeout(() => {
                actor.toggleStatusEffect(statusId, { active: false })
            }, 1000);

        }
    }
}
