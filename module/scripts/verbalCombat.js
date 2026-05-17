export function addVerbalCombatChatListeners(html) {
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

    if (!html.find('button.vcDamage') && !!html.find('a.apply-status'))
        return;

    html.find('button.vcDamage').on('click', _ => onDamage(message));
}

function onDamage(message) {
    let verbalCombat = message.getFlag('thewitchertrpg', 'verbalCombat');
    let damage = message.getFlag('thewitchertrpg', 'damage');
    rollDamage(verbalCombat, damage);
}

export async function rollDamage(verbalCombat, damage) {

    let messageData = {}
    messageData.flavor = `<div class="verbalcombat-damage-message" <h1>${game.i18n.localize("WITCHER.table.Damage")}: ${game.i18n.localize(verbalCombat.name)} </h1>`;

    let message = await (await new Roll(damage.formula).evaluate()).toMessage(messageData)
    message.setFlag('thewitchertrpg', 'damage', damage);
}


export async function applyDamage(targetActor, totalDamage, messageId) {
    let currentResolve = targetActor.system.derivedStats.resolve.value
    targetActor.update({ 'system.derivedStats.resolve.value': currentResolve - totalDamage });
}
