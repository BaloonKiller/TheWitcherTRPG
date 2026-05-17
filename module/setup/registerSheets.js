import WitcherCharacterSheet from "../actor/sheets/WitcherCharacterSheet.js";
import WitcherMonsterSheet from "../actor/sheets/WitcherMonsterSheet.js";
import WitcherLootSheet from "../actor/sheets/WitcherLootSheet.js";

import WitcherItemSheet from "../item/sheets/WitcherItemSheet.js";
import WitcherWeaponSheet from "../item/sheets/WitcherWeaponSheet.js";
import WitcherDiagramSheet from "../item/sheets/WitcherDiagramSheet.js";
import WitcherContainerSheet from "../item/sheets/WitcherContainerSheet.js";
import WitcherMysterySheet from "../actor/sheets/investigation/WitcherMysterySheet.js";
import WitcherClueSheet from "../item/sheets/investigation/WitcherClueSheet.js";
import WitcherObstacleSheet from "../item/sheets/investigation/WitcherObstacleSheet.js";
import { ActorSheetV1, ActorsCollection, ItemSheetV1, ItemsCollection } from "./foundry-compat.js";

const SHEET_SCOPE = "thewitchertrpg";

export const registerSheets = () => {
    ItemsCollection.unregisterSheet("core", ItemSheetV1);
    ItemsCollection.registerSheet(SHEET_SCOPE, WitcherItemSheet, { makeDefault: true });
    ItemsCollection.registerSheet(SHEET_SCOPE, WitcherWeaponSheet, {
        makeDefault: true,
        types: ['weapon']
    });
    ItemsCollection.registerSheet(SHEET_SCOPE, WitcherDiagramSheet, {
        makeDefault: true,
        types: ['diagrams']
    });
    ItemsCollection.registerSheet(SHEET_SCOPE, WitcherContainerSheet, {
        makeDefault: true,
        types: ['container']
    });

    ActorsCollection.unregisterSheet("core", ActorSheetV1);
    ActorsCollection.registerSheet(SHEET_SCOPE, WitcherCharacterSheet, {
        makeDefault: true,
        types: ['character']
    });
    ActorsCollection.registerSheet(SHEET_SCOPE, WitcherMonsterSheet, {
        makeDefault: true,
        types: ['monster']
    });
    ActorsCollection.registerSheet(SHEET_SCOPE, WitcherLootSheet, {
        makeDefault: true,
        types: ['loot']
    });

    ActorsCollection.registerSheet(SHEET_SCOPE, WitcherMysterySheet, {
        makeDefault: true,
        types: ['mystery']
    });
    ItemsCollection.registerSheet(SHEET_SCOPE, WitcherClueSheet, {
        makeDefault: true,
        types: ['clue']
    });
    ItemsCollection.registerSheet(SHEET_SCOPE, WitcherObstacleSheet, {
        makeDefault: true,
        types: ['obstacle']
    });
}
