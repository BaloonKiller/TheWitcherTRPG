export const registerSettings = function() {
    // Register any custom system settings here
    game.settings.register("thewitchertrpg", "useOptionalAdrenaline", {
        name: "WITCHER.Settings.Adrenaline",
        hint: "WITCHER.Settings.AdrenalineDetails",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
      });
    game.settings.register("thewitchertrpg", "displayRollsDetails", {
        name: "WITCHER.Settings.displayRollDetails",
        hint: "WITCHER.Settings.displayRollDetailsHint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
      });
    game.settings.register("thewitchertrpg", "useWitcherFont", {
        name: "WITCHER.Settings.specialFont",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
      });
    game.settings.register("thewitchertrpg", "displayRep", {
        name: "WITCHER.Settings.displayReputation",
        hint: "WITCHER.Settings.displayReputationHint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
      });
    game.settings.register("thewitchertrpg", "useOptionalVerbalCombat", {
        name: "WITCHER.Settings.useVerbalCombatRule",
        hint: "WITCHER.Settings.useVerbalCombatRuleHint",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
      });
    game.settings.register("thewitchertrpg", "clickableImageItemTypes", {
        name: "WITCHER.Settings.clickableImageItemTypes",
        hint: "WITCHER.Settings.clickableImageItemTypesHint",
        scope: "world",
        config: true,
        type: String,
        default: "valuable"
      });
    game.settings.register("thewitchertrpg", "clickableImageCheckboxForGMOnly", {
        name: "WITCHER.Settings.clickableImageCheckboxForGMOnly",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
      });

    game.settings.register("thewitchertrpg", "systemMigrationVersion", {
        name: "System Migration Version",
        scope: "world",
        config: false,
        type: Number,
        default: 1.018
    });
}