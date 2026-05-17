import { getCurrentToken } from "./helper.js";
import { getRandomInt } from "./witcher.js";
import { prepareDamageEffects, resolveDamageEffects } from "./damageEffects.mjs";
import { fromUuidSync } from "../setup/foundry-compat.js";

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
    html.find('.attack-message button.damage').remove();
    syncDamageResolutionControls(message, html);

    if (!html.find('button.damage').length && !html.find('a.apply-status').length)
        return;

    html.find('button.damage').on('click', event => onDamage(message, event));
    html.find('a.apply-status').on('click', event => onApplyStatus(event));
}

async function onDamage(message, event) {
    await rollAttackMessageDamage(message, undefined, event?.currentTarget);
}

export async function rollAttackMessageDamage(message, defenceResolution = undefined, damageButton = null, options = {}) {
    const item = message.getFlag('thewitchertrpg', 'attack')?.item
        ?? message.getFlag('thewitchertrpg', 'item')
        ?? message.getFlag('thewitchertrpg', 'spell')
        ?? itemFromDamageButton(damageButton);
    const storedDamage = message.getFlag('thewitchertrpg', 'damage') ?? damageFromButton(damageButton);

    if (!item || !storedDamage) {
        ui.notifications.error(game.i18n.localize("WITCHER.NoDamageSpecified"));
        return null;
    }

    const damage = cloneData(storedDamage);
    const hasBaseDamageTotal = options.baseDamageTotal !== null
        && options.baseDamageTotal !== undefined
        && options.baseDamageTotal !== "";
    const baseDamageTotal = Number(options.baseDamageTotal);
    if (hasBaseDamageTotal && Number.isFinite(baseDamageTotal)) {
        damage.formula = String(baseDamageTotal);
    }
    const resolvedDefence = defenceResolution === undefined
        ? findDefenceResolutionForAttack(message)
        : defenceResolution;

    if (damage.location?.name == "randomSpell") {
        const targetToken = resolvedDefence?.targetTokenUuid
            ? fromUuidSync(resolvedDefence.targetTokenUuid)
            : null;
        const targetDocument = resolvedDefence?.targetActorUuid
            ? fromUuidSync(resolvedDefence.targetActorUuid)
            : null;
        const actor = targetToken?.actor
            ?? targetDocument?.actor
            ?? targetDocument
            ?? game.actors.get(message.speaker.actor)
            ?? getCurrentToken()?.actor;
        const randomLocation = actor?.type === "monster" ? "randomMonster" : "randomHuman";
        damage.location = actor?.getLocationObject(randomLocation) ?? damage.location;
    }
    if (resolvedDefence) {
        damage.defenceResolution = cloneData(resolvedDefence);
    } else {
        delete damage.defenceResolution;
    }
    return rollDamage(item, damage);
}

export async function rollDamage(item, damage) {
    let damageOptions = {
        armorPiercing: item.system?.armorPiercing || damage.ammunition?.system.armorPiercing,
        improvedArmorPiercing: item.system?.improvedArmorPiercing || damage.ammunition?.system.improvedArmorPiercing,
        ablating: item.system?.ablating || damage.ammunition?.system.ablating,
        ignoreArmor: Boolean(item.system?.ignoreArmor || damage.ignoreArmor)
    }

    let messageData = {}
    messageData.flavor = `<div class="damage-message"><h1><img src="${item.img}" class="item-img" />${game.i18n.localize("WITCHER.table.Damage")}: ${item.name}</h1>`;

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

    const criticalBonusDamage = Number(damage.defenceResolution?.bonusDamage);
    if (Number.isFinite(criticalBonusDamage) && criticalBonusDamage > 0) {
        messageData.flavor += `
            <div class="damage-critical-bonus">
                <i class="fas fa-bolt" aria-hidden="true"></i>
                <span>${game.i18n.localize("WITCHER.Damage.criticalBonus")}</span>
                <strong>+${criticalBonusDamage}</strong>
            </div>`;
    }

    const preparedEffects = prepareDamageEffects(
        damage.effects,
        CONFIG.WITCHER.statusEffects,
        value => game.i18n.localize(value)
    );
    const resolvedEffects = resolveDamageEffects(preparedEffects, () => getRandomInt(100));
    damage.resolvedEffects = resolvedEffects;

    if (resolvedEffects.length > 0) {
        messageData.flavor += `<b>${game.i18n.localize("WITCHER.Item.Effect")}:</b>`;

        resolvedEffects.forEach(effect => {
            messageData.flavor += `<div class="flex gap">`;
            const statusEffect = effect.statusEffect
                ? CONFIG.WITCHER.statusEffects.find(status => status.id == effect.statusEffect)
                : null;
            const statusLabel = statusEffect ? game.i18n.localize(statusEffect.name) : "";
            if (effect.name != '' && !hasSameLabel(effect.name, statusLabel)) {
                messageData.flavor += `<span>${effect.name}</span>`;
            }
            if (statusEffect) {
                const statusContent = `<img class='chat-icon' src='${statusEffect.img}' /> <span>${statusLabel}</span>`;
                messageData.flavor += effect.success
                    ? `<a class='apply-status' data-status='${effect.statusEffect}'>${statusContent}</a>`
                    : `<span class='apply-status'>${statusContent}</span>`;
            }
            if (effect.percentage) {
                messageData.flavor += `<div data-tooltip='${game.i18n.localize("WITCHER.Effect.Rolled")}: ${effect.roll}'>(${effect.percentage}%) `;
                if (!effect.success) {
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

    messageData.flavor += `</div>`;
    const roll = await new Roll(damage.formula).evaluate();
    const message = await roll.toMessage(messageData);
    await message.update({ content: buildDamageRollContent(roll) });
    await Promise.all([
        message.setFlag('thewitchertrpg', 'damageOptions', damageOptions),
        message.setFlag('thewitchertrpg', 'damage', damage)
    ]);
    return message;
}

function buildDamageRollContent(roll) {
    const diceGroups = (roll.dice ?? []).map(die => {
        const results = (die.results ?? []).map(result => {
            const classes = ["damage-die-result"];
            if (result.active === false || result.discarded) classes.push("is-discarded");
            if (result.exploded) classes.push("is-exploded");
            if (result.rerolled) classes.push("is-rerolled");

            return `<span class="${classes.join(" ")}">${escapeHtml(result.result)}</span>`;
        }).join("");
        const expression = die.expression
            ?? `${die.number ?? die.results?.length ?? ""}d${die.faces ?? "?"}${(die.modifiers ?? []).join("")}`;

        return `
            <div class="damage-roll-dice-group">
                <span class="damage-roll-dice-label">${escapeHtml(expression)}</span>
                <div class="damage-roll-dice-results">${results}</div>
            </div>`;
    }).join("");

    return `
        <section class="damage-roll-summary">
            <header class="damage-roll-heading">
                <span>
                    <i class="fas fa-dice-d6" aria-hidden="true"></i>
                    <strong>${escapeHtml(game.i18n.localize("WITCHER.Damage.roll"))}</strong>
                </span>
                <strong class="damage-roll-total dice-total">${escapeHtml(roll.total)}</strong>
            </header>
            <div class="damage-roll-formula">
                <span>${escapeHtml(game.i18n.localize("WITCHER.Damage.formula"))}</span>
                <strong>${escapeHtml(roll.formula)}</strong>
            </div>
            ${diceGroups ? `
                <div class="damage-roll-dice">
                    <span class="damage-roll-dice-title">${escapeHtml(game.i18n.localize("WITCHER.Damage.dice"))}</span>
                    ${diceGroups}
                </div>` : ""}
        </section>`;
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

function syncDamageResolutionControls(message, html) {
    const buttons = html.find('button.resolve-damage');
    if (!buttons.length) return;

    const resolution = message.getFlag('thewitchertrpg', 'damageResolution');
    if (!resolution?.state) return;

    if (resolution.state === "preparing") {
        buttons.prop('disabled', true).html(
            `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>${game.i18n.localize("WITCHER.Chat.PreparingCritical")}</span>`
        );
        return;
    }

    if (resolution.state === "rolling") {
        buttons.prop('disabled', true).html(
            `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>${game.i18n.localize("WITCHER.Chat.RollingDamage")}</span>`
        );
        return;
    }

    if (resolution.state === "applied") {
        buttons.prop('disabled', true).html(
            `<i class="fas fa-check" aria-hidden="true"></i><span>${game.i18n.localize("WITCHER.Chat.DamageResolved")}</span>`
        );
        return;
    }

    if (resolution.state === "superseded") {
        buttons.prop('disabled', true).html(
            `<i class="fas fa-ban" aria-hidden="true"></i><span>${game.i18n.localize("WITCHER.Chat.RerollSuperseded")}</span>`
        );
        return;
    }

    if (resolution.state === "rolled") {
        buttons.html((index, currentButton) => {
            const icon = currentButton.dataset.derivedStat === "sta" ? "fa-bolt" : "fa-heart-broken";
            return `<i class="fas ${icon}" aria-hidden="true"></i><span>${game.i18n.localize("WITCHER.Chat.ContinueDamage")}</span>`;
        });
    }
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

function hasSameLabel(left, right) {
    return Boolean(right) && String(left).trim().toLocaleLowerCase() === String(right).trim().toLocaleLowerCase();
}

function findDefenceResolutionForAttack(attackMessage) {
    const messages = game.messages?.contents ?? Array.from(game.messages ?? []);
    return [...messages]
        .reverse()
        .map(message => message.getFlag?.("thewitchertrpg", "defenceResolution"))
        .find(resolution => resolution?.sourceAttackMessageId === attackMessage?.id)
        ?? null;
}

function cloneData(value) {
    return globalThis.foundry?.utils?.deepClone?.(value)
        ?? JSON.parse(JSON.stringify(value));
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
