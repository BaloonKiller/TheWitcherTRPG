import { WITCHER } from "./setup/config.js";
import * as Chat from "./scripts/chat.js";
import * as Attack from "./scripts/attack.js"
import * as VerbalCombat from "./scripts/verbalCombat.js"
import { registerSettings } from "./setup/settings.js";
import { sumItemProperty, updateDerived } from "./scripts/witcher.js";

import WitcherItem from "./item/witcherItem.js";
import WitcherActor from "./actor/witcherActor.js";

import { registerDataModels } from "./setup/registerDataModels.js";
import { registerSheets } from "./setup/registerSheets.js";
import { MacroDocument, loadTemplates, registerFoundryCompatibility, registerTokenActorSheetDoubleClick } from "./setup/foundry-compat.js";
import { migrateGeneratedImagePaths } from "./setup/migrations.js";
import { registerDamageStatusEffectSyncHooks } from "./scripts/damageEffects.mjs";
import { registerCriticalWoundEffectSyncHooks } from "./scripts/criticalWoundEffects.mjs";
import { registerCurrencyItemMigrationHooks } from "./scripts/currencyLedger.js";
import { registerDeathSaveHooks } from "./scripts/deathSaves.mjs";
import { normalizeNegativeResolveValues } from "./scripts/verbalCombatDamage.mjs";
import { registerSpellAreaEffectHooks } from "./scripts/spellAreaEffects.mjs";
import { registerOngoingStatusEffectHooks } from "./scripts/ongoingStatusEffects.mjs";
import { registerSpellBuffHooks } from "./scripts/spellBuffs.mjs";

async function preloadHandlebarsTemplates() {
    const templatePath = [
        "systems/thewitchertrpg/templates/sheets/actor/character-sheet.hbs",
        "systems/thewitchertrpg/templates/sheets/actor/monster-sheet.hbs",
        "systems/thewitchertrpg/templates/sheets/actor/loot-sheet.hbs",

        "systems/thewitchertrpg/templates/partials/character-header.hbs",
        "systems/thewitchertrpg/templates/partials/tab-skills.hbs",
        "systems/thewitchertrpg/templates/partials/tab-profession.hbs",
        "systems/thewitchertrpg/templates/partials/tab-background.hbs",
        "systems/thewitchertrpg/templates/partials/tab-inventory.hbs",
        "systems/thewitchertrpg/templates/partials/tab-inventory-diagrams.hbs",
        "systems/thewitchertrpg/templates/partials/tab-inventory-valuables.hbs",
        "systems/thewitchertrpg/templates/partials/tab-inventory-mounts.hbs",
        "systems/thewitchertrpg/templates/partials/tab-inventory-runes-glyphs.hbs",
        "systems/thewitchertrpg/templates/partials/tab-magic.hbs",
        "systems/thewitchertrpg/templates/partials/crit-wounds-table.hbs",
        "systems/thewitchertrpg/templates/partials/substances.hbs",
        "systems/thewitchertrpg/templates/partials/monster-skill-tab.hbs",
        "systems/thewitchertrpg/templates/partials/monster-inventory-tab.hbs",
        "systems/thewitchertrpg/templates/partials/monster-details-tab.hbs",
        "systems/thewitchertrpg/templates/partials/monster-spell-tab.hbs",
        "systems/thewitchertrpg/templates/partials/skill-display.hbs",
        "systems/thewitchertrpg/templates/partials/monster-skill-display.hbs",
        "systems/thewitchertrpg/templates/partials/loot-item-display.hbs",
        "systems/thewitchertrpg/templates/partials/item-header.hbs",
        "systems/thewitchertrpg/templates/partials/item-image.hbs",
        "systems/thewitchertrpg/templates/partials/associated-item.hbs",

        "systems/thewitchertrpg/templates/sheets/investigation/mystery-sheet.hbs",
        "systems/thewitchertrpg/templates/partials/investigation/clue-display.hbs",
        "systems/thewitchertrpg/templates/partials/investigation/obstacle-display.hbs",

        "systems/thewitchertrpg/templates/sheets/verbal-combat.hbs",
        "systems/thewitchertrpg/templates/sheets/weapon-attack.hbs"
    ];
    return loadTemplates(templatePath);
}

Hooks.once("init", async function () {
    console.log("TheWitcherTRPG | init system");

    CONFIG.WITCHER = WITCHER;
    CONFIG.statusEffects = CONFIG.WITCHER.statusEffectsById;
    CONFIG.Item.documentClass = WitcherItem;
    CONFIG.Actor.documentClass = WitcherActor;

    registerFoundryCompatibility();
    registerTokenActorSheetDoubleClick();
    registerHandlebarsHelpers();
    registerDataModels();
    registerSettings();
    registerSheets();
    registerDamageStatusEffectSyncHooks(Hooks, updateDerived);
    registerCriticalWoundEffectSyncHooks(Hooks, updateDerived);
    registerCurrencyItemMigrationHooks();
    registerDeathSaveHooks(Hooks, updateDerived);
    registerSpellAreaEffectHooks(Hooks, updateDerived);
    registerOngoingStatusEffectHooks();
    registerSpellBuffHooks();
    await preloadHandlebarsTemplates();
});


Hooks.on("renderChatLog", (app, html, data) => {
    Chat.addChatListeners(html)
}
);

Hooks.on('renderChatMessageHTML', (message, html, data) => {
    Chat.syncRollRerollMessageControls(message, html)
    Attack.chatMessageListeners(message, html)
    VerbalCombat.chatMessageListeners(message, html)
});

/* -------------------------------------------- */
/*  Hotbar Macros                               */
/* -------------------------------------------- */
Hooks.once("ready", async function () {
    try {
        await migrateGeneratedImagePaths();
    } catch (error) {
        console.error("thewitchertrpg | Generated image migration failed.", error);
        ui.notifications.error(game.i18n.localize("WITCHER.Migration.ImagesFailed"));
    }

    try {
        await normalizeNegativeResolveValues();
    } catch (error) {
        console.error("thewitchertrpg | Negative Resolve normalization failed.", error);
    }

    // Wait to register hotbar drop hook on ready so that modules could register earlier if they want to
    Hooks.on("hotbarDrop", (bar, data, slot) => createBoilerplateMacro(data, slot));

    if (game.settings.get("thewitchertrpg", "useWitcherFont")) {
        let els = document.getElementsByClassName("game")
        Array.prototype.forEach.call(els, function (el) {
            if (el) { el.classList.add("witcher-style") }
        });
        let chat = document.getElementById("chat-log")
        if (chat) { chat.classList.add("witcher-style") }
    }
});

Hooks.once("dragRuler.ready", (SpeedProvider) => {
    class FictionalGameSystemSpeedProvider extends SpeedProvider {
        get colors() {
            return [
                { id: "walk", default: 0x00FF00, name: "witcher.speeds.walk" },
                { id: "dash", default: 0xFFFF00, name: "witcher.speeds.dash" },
                { id: "run", default: 0xFF8000, name: "witcher.speeds.run" }
            ]
        }

        getRanges(token) {
            let baseSpeed = token.actor.system.stats.spd.current
            // A character can always walk it's base speed and dash twice it's base speed
            let moveSpeed = baseSpeed % 2 == 0 ? baseSpeed : baseSpeed + 1;
            let runspeed = (baseSpeed * 3) % 2 == 0 ? baseSpeed * 3 : baseSpeed * 3 + 1;
            const ranges = [
                { range: moveSpeed, color: "walk" },
                { range: runspeed, color: "dash" }
            ]
            return ranges
        }
    }

    dragRuler.registerSystem("thewitchertrpg", FictionalGameSystemSpeedProvider)
})

Hooks.once("polyglot.init", (LanguageProvider) => {
    class FictionalGameSystemLanguageProvider extends LanguageProvider {
        languages = {
            "common": { label: "Common", font: "Thorass", },
            "dwarven": { label: "Dwarven", font: "Dethek", },
            "elder": { label: "Elder Speech", font: "Espruar", }
        }

        getUserLanguages(actor) {
            let known_languages = new Set();
            let literate_languages = new Set();
            known_languages.add("common")
            if (actor.system.skills.int.eldersp.isProfession || actor.system.skills.int.eldersp.isPickup || actor.system.skills.int.eldersp.isLearned || actor.system.skills.int.eldersp.value > 0) {
                known_languages.add("elder")
            }
            if (actor.system.skills.int.dwarven.isProfession || actor.system.skills.int.dwarven.isPickup || actor.system.skills.int.dwarven.isLearned || actor.system.skills.int.dwarven.value > 0) {
                known_languages.add("dwarven")
            }
            if (actor.system.skills.int.commonsp.isProfession || actor.system.skills.int.commonsp.isPickup || actor.system.skills.int.commonsp.isLearned || actor.system.skills.int.commonsp.value > 0) {
                known_languages.add("common")
            }
            return [known_languages, literate_languages];
        }
    }
    game.polyglot.api.registerSystem(FictionalGameSystemLanguageProvider)
})

Hooks.on("getChatLogEntryContext", Chat.addChatMessageContextOptions);
Hooks.on("getChatMessageContextOptions", Chat.addChatMessageContextOptions);

/**
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
async function createBoilerplateMacro(data, slot) {
    if (data.type == 'Actor') {
        const actor = game.actors.get(data.id);
        if (!actor) {
            return;
        }
        const command = `const actor = game.actors.get('${data.id}'); actor?.sheet?.render(true, { popOut: true });`;
        let macro =
            game.macros.find(macro => macro.name === actor.name && macro.command === command);

        if (!macro) {
            macro = await MacroDocument.create({
                name: actor.name,
                type: 'script',
                img: actor.img,
                command: command
            }, { renderSheet: false });
        }
        game.user.assignHotbarMacro(macro, slot);
        return false;
    }
    else if (!("item" in data)) {
        return ui.notifications.warn("You can only create macro buttons for owned Items");
    }
    else if (data.item.type == 'weapon') {
        const weapon = data.item;
        let foundActor = null
        game.actors.forEach(actor => {
            actor.items.forEach(item => {
                if ((weapon.id ?? weapon._id) == item.id) {
                    foundActor = actor
                }
            });
        });
        if (!foundActor) {
            return ui.notifications.warn("You can only create macro buttons with the original character");
        }
        const command =
            `const actor = game.actors.get('${foundActor.id}'); await actor?.rollItem("${weapon.id ?? weapon._id}");`;
        let macro = game.macros.find(m => (m.name === weapon.name) && (m.command === command));
        if (!macro) {
            macro = await MacroDocument.create({
                name: weapon.name,
                type: "script",
                img: weapon.img,
                command: command,
                flags: { "boilerplate.itemMacro": true }
            });
        }
        await game.user.assignHotbarMacro(macro, slot);
        return false;
    }
    else if (data.item.type == 'spell') {
        const spell = data.item;
        let foundActor = null
        game.actors.forEach(actor => {
            actor.items.forEach(item => {
                if ((spell.id ?? spell._id) == item.id) {
                    foundActor = actor
                }
            });
        });
        if (!foundActor) {
            return ui.notifications.warn("You can only create macro buttons with the original character");
        }
        const command =
            `const actor = game.actors.get('${foundActor.id}'); await actor?.rollSpell("${spell.id ?? spell._id}");`;
        let macro = game.macros.find(m => (m.name === spell.name) && (m.command === command));
        if (!macro) {
            macro = await MacroDocument.create({
                name: spell.name,
                type: "script",
                img: spell.img,
                command: command,
                flags: { "boilerplate.itemMacro": true }
            });
        }
        await game.user.assignHotbarMacro(macro, slot);
        return false;
    }
}

function registerHandlebarsHelpers() {
    Handlebars.registerHelper("select", function (selected, options) {
        const html = options.fn(this);
        const values = new Set((Array.isArray(selected) ? selected : [selected]).map(String));
        const selectedHtml = html.replace(/(<option\b[^>]*\bvalue=(["'])(.*?)\2[^>]*)(>)/g, (match, start, quote, value, end) => {
            if (!values.has(value) || /\sselected\b/.test(start)) {
                return match;
            }
            return `${start} selected${end}`;
        });
        return new Handlebars.SafeString(selectedHtml);
    });

    Handlebars.registerHelper("getOwnedComponentCount", function (actor, componentName) {
        if (!actor) {
            console.warn("'actor' parameter passed into getOwnedComponentCount is undefined. That might be a problem with one of the selected actors diagrams.");
            return 0;
        }
        let ownedComponent = actor.findNeededComponent(componentName);
        return sumItemProperty(ownedComponent, "quantity");
    });

    Handlebars.registerHelper("getSetting", function (setting) {
        return game.settings.get("thewitchertrpg", setting);
    });

    Handlebars.registerHelper("window", function (...props) {
        props.pop();
        return props.reduce((result, prop) => result[prop], window);
    });

    Handlebars.registerHelper("includes", function (csv, substr) {
        return csv.split(",").map(v => v.trim()).includes(substr);
    });
}
