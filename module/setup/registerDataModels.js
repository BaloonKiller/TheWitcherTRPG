import MonsterData from "../data/actor/monsterData.js";
import ContainerData from "../data/item/containerData.js";
import LootData from "../data/actor/lootData.js";
import CharacterData from "../data/actor/characterData.js";
import ValuableData from "../data/item/valuableData.js";
import WeaponData from "../data/item/weaponData.js";
import EnhancementData from "../data/item/enhancementData.js";
import MountData from "../data/item/mountData.js";
import AlchemicalData from "../data/item/alchemicalData.js";
import MutagenData from "../data/item/mutagenData.js";
import NoteData from "../data/item/noteData.js";
import ComponentData from "../data/item/componentData.js";
import RaceData from "../data/item/raceData.js";
import ProfessionData from "../data/item/professionData.js";
import SpellData from "../data/item/spellData.js";
import DiagramData from "../data/item/diagramData.js";
import EffectData from "../data/item/effectData.js";
import ArmorData from "../data/item/armorData.js";
import ClueData from "../data/investigation/clueData.js";
import ObstacleData from "../data/investigation/obstacleData.js";
import MysteryActorData from "../data/investigation/mysteryActorData.js";


export const registerDataModels = () => {
    Object.assign(CONFIG.Actor.dataModels, {
        // The keys are the Actor types declared in system.json.
        character: CharacterData,
        monster: MonsterData,
        loot: LootData,

        mystery: MysteryActorData
      })
 
      Object.assign(CONFIG.Item.dataModels, {
         // The keys are the Item types declared in system.json.
        alchemical: AlchemicalData,
        armor: ArmorData,
        container: ContainerData,
        component: ComponentData,
        diagrams: DiagramData,
        effect: EffectData,
        enhancement: EnhancementData,
        mount: MountData,
        mutagen: MutagenData,
        note: NoteData,
        profession: ProfessionData,
        race: RaceData,
        spell: SpellData,
        valuable: ValuableData,
        weapon: WeaponData,

        clue: ClueData,
        obstacle: ObstacleData
       })
}
