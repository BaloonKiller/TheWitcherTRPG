import { spawnSync } from "child_process";
import { ClassicLevel } from "classic-level";
import fs from "fs/promises";
import path from "path";
import {
  applyDamageCriticalWound,
  buildCriticalWoundRecord,
  getCriticalWound,
  getCriticalWoundBonusDamage,
  getCriticalWoundEffect,
  getCriticalWoundLocation,
  getCriticalWoundResultTarget,
  getCriticalWoundTableTarget,
} from "../module/scripts/criticalWounds.mjs";
import {
  applyCriticalWoundConsequences,
  getCriticalWoundMechanics,
  getCriticalWoundModifierSources,
  synchronizeCriticalWoundEffects,
} from "../module/scripts/criticalWoundEffects.mjs";
import {
  advanceCriticalWoundHealing,
  getCriticalWoundHealingTime,
  initializeCriticalWoundHealing,
} from "../module/scripts/criticalWoundHealing.mjs";
import {
  applySuccessfulDamageStatusEffects,
  buildDamageStatusEffectItemData,
  getSuccessfulStatusEffectIds,
  prepareDamageEffects,
  resolveDamageEffects,
  synchronizeDeletedDamageEffectItem,
  synchronizeDeletedNativeStatusEffect,
} from "../module/scripts/damageEffects.mjs";
import {
  buildDamageResourceUpdate,
  shouldApplyDamageEffects,
  shouldApplyCriticalWound,
} from "../module/scripts/damageApplication.mjs";
import {
  buildInitialStatusLifecycle,
  calculateStackedArmorSp,
  getDamageStatusDurationRounds,
  getOngoingStatusDamage,
  getStatusTurnPlan,
  parseStatusDurationRounds,
  processCurrentCombatantStatusEffects,
  resolveFireLocationDamage,
} from "../module/scripts/ongoingStatusEffects.mjs";
import {
  getEffectiveSpellDefence,
  getSpellDamageFormulaDisplay,
  getSpellDefenceActions,
  hasSpellDefenceRoll,
  restrictDefenceButtons,
  shouldResolveAttackCriticalWound,
} from "../module/scripts/spellResolution.mjs";
import {
  applySpellShieldBuff,
  clearSpellShieldBuff,
  getActorSpellShield,
  getSpellShieldDefinition,
  getSpellShieldFormula,
  getSpellShieldTurnPlan,
  processCurrentCombatantSpellBuffs,
} from "../module/scripts/spellBuffs.mjs";
import {
  applySerializedRollConfig,
  createRollRerollFlag,
  getNextRerollChain,
  getRollRerollAvailability,
} from "../module/scripts/rollRerolls.mjs";
import {
  buildPersistentSpellAreaEffect,
  buildSpellAreaDurationData,
  buildSpellAreaShape,
  collectSpellAreaTargets,
  createSpellAreaResolution,
  isExcludedSpellAreaCaster,
  isSpellAreaResolutionComplete,
  getSpellAreaExpirationState,
  normalizeSpellAreaSize,
  parseSpellAreaDurationRounds,
  renderSpellAreaResolution,
  replaceSpellAreaResolution,
  updateSpellAreaTargetData,
} from "../module/scripts/spellArea.mjs";
import {
  getSaveDetails,
  getUpdatedHpValue,
  normalizeLuckSpend,
  parseHpInputValue,
  registerDeathSaveHooks,
  resetDeathSavesAfterRecovery,
  resolveDeathSave,
} from "../module/scripts/deathSaves.mjs";
import {
  buildVerbalDamageResourceUpdate,
  normalizeNegativeResolveValues,
} from "../module/scripts/verbalCombatDamage.mjs";
import {
  depositCurrencyItem,
  getCurrencyItemType,
  migrateLegacyCurrencyItems,
} from "../module/scripts/currencyItems.mjs";
import {
  canCraftFromRecipe,
  getMemorizedRecipeCount,
  getRecipeMemoryCapacity,
  getRecipeOutputQuantity,
  hasPhysicalRecipe,
} from "../module/scripts/craftingRecipes.mjs";
import {
  buildTransportStorageUpdate,
  calculateCarriedInventoryWeight,
  calculateItemStackWeight,
  calculateStoredItemsWeight,
  getTransportAccessoryProfile,
  getTransportCargoState,
  getTransportControlSkill,
  getTransportDerivedStats,
  getTransportRepairRequirement,
  inferTransportKind,
  migrateTransportSystemData,
  parseLegacyTransportDetails,
  resolveTransportDamage,
  usesPullingAnimalSpeed,
} from "../module/scripts/transport.mjs";
import {
  buildContainerStorageUpdate,
  calculateContainerContentWeight,
  getKnownContainerCapacity,
  getContainerState,
  getContainerTransferLimit,
  isContainerItem,
  migrateLegacyContainerItems,
  migrateContainerSystemData,
  moveContainerBetweenActors,
  normalizeContainerCapacity,
  prepareContainerItemSource,
} from "../module/scripts/containerStorage.mjs";
import { prepareApplicationTab } from "../module/scripts/applicationTabs.mjs";
import {
  buildContainerDocumentUpdate,
  buildTransportDocumentUpdate,
  flattenDocumentUpdate,
} from "../module/scripts/documentUpdates.mjs";
import {
  findStackableInventoryItem,
  findStackableStoredItem,
  getItemDropSource,
  getItemQuantityTransfer,
  getSingleItemTransfer,
} from "../module/scripts/inventoryDrops.mjs";
import {
  findOrphanedStoredItems,
  findUnmarkedStoredItems,
  resolveActorOwnedItems,
} from "../module/scripts/storedItems.mjs";
import {
  addActorSkillEffectModifiers,
  getActorSkillEffectModifiers,
  isActorEffectItemActive,
} from "../module/scripts/actorSkillEffects.mjs";
import {
  CURATED_ITEM_IMAGE_PATHS,
  getCuratedItemImage,
  normalizeGeneratedImagePath,
} from "../module/setup/imageMigrations.mjs";

const workspace = process.cwd();
const temporaryRoot = path.join(workspace, ".tmp", "project-validation");
const system = await readJson(path.join(workspace, "system.json"));

await readJson(path.join(workspace, "package.json"));
await validateSystemManifest();

for (const file of await listFiles(path.join(workspace, "lang"), (entry) => entry.endsWith(".json"))) {
  const translations = await readJson(file);
  validateLocalizationPaths(translations, file);
}

const moduleJavaScriptFiles = await listFiles(path.join(workspace, "module"), isJavaScript);
const javascriptFiles = [
  ...moduleJavaScriptFiles,
  ...await listFiles(path.join(workspace, "utils"), isJavaScript),
];

for (const file of javascriptFiles) {
  const source = await fs.readFile(file, "utf8");
  const result = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    encoding: "utf8",
    input: source,
  });
  if (result.status !== 0) {
    throw new Error(`JavaScript syntax check failed for ${path.relative(workspace, file)}:\n${result.stderr || result.stdout}`);
  }
}

validateCriticalWoundThresholds();
validateCriticalWoundLocations();
validateDamageResourceUpdates();
validateSpellResolution();
await validateSpellBuffs();
await validateDefenceDialogLayout();
validateRollRerolls();
await validateRollRerollWiring();
validateSpellAreas();
await validateDeathSaves();
await validateVerbalDamageResourceUpdates();
await validateCriticalWoundApplication();
await validateCriticalWoundEffects();
validateCriticalWoundHealing();
await validateDamageEffects();
await validateOngoingStatusEffects();
validateStatusSkillModifiers();
await validateStatusSkillModifierWiring();
await validateCurrencyItems();
validateCraftingRecipes();
await validateContainerStorage();
validateTransport();
validateApplicationTabs();
await validateApplicationV2Migration(moduleJavaScriptFiles);
validateDocumentUpdates();
validateInventoryDrops();
validateStoredItems();
await validateImageMigrations();

const templates = await listFiles(path.join(workspace, "templates"), (entry) => entry.endsWith(".hbs"));
for (const file of templates) {
  const source = await fs.readFile(file, "utf8");
  if (!source.trim()) throw new Error(`Empty template: ${path.relative(workspace, file)}`);
  const opens = source.match(/{{/g)?.length ?? 0;
  const closes = source.match(/}}/g)?.length ?? 0;
  if (opens !== closes) throw new Error(`Unbalanced Handlebars delimiters: ${path.relative(workspace, file)}`);
}

await fs.rm(temporaryRoot, { recursive: true, force: true });
await fs.mkdir(temporaryRoot, { recursive: true });

try {
  for (const pack of system.packs) await validatePack(pack);
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

console.log(`Validated ${javascriptFiles.length} JavaScript files, ${templates.length} templates and ${system.packs.length} compendium packs.`);

async function validateImageMigrations() {
  const systemPrefix = "systems/thewitchertrpg/assets/images/";
  if (normalizeGeneratedImagePath(`${systemPrefix}generated/witcher-signs/aard-sweep.webp`)
      !== `${systemPrefix}witcher-signs/aard.png`
    || normalizeGeneratedImagePath(`${systemPrefix}generated/witcher-signs/active-shield.webp`)
      !== `${systemPrefix}witcher-signs/quen.png`
    || normalizeGeneratedImagePath(
      "https://assets.forge-vtt.com/bazaar/core/icons/commodities/metal/ingot-stamped-steel.webp",
    ) !== `${systemPrefix}components/mahakam-steel.png`
    || normalizeGeneratedImagePath("icons/svg/book.svg") !== "icons/svg/book.svg") {
    throw new Error("Outdated Witcher sign and Mahakam Steel image paths must migrate to local assets.");
  }

  if (getCuratedItemImage({ type: "mutagen", name: "Arachas Mutagen" })
      !== `${systemPrefix}mutagens/arachas-mutagen.png`
    || getCuratedItemImage({ type: "alchemical", name: "Swallow" })
      !== `${systemPrefix}potions/swallow.png`
    || getCuratedItemImage({ type: "weapon", name: "Northern Wind" })
      !== `${systemPrefix}bombs/northern-wind.png`
    || getCuratedItemImage({ type: "weapon", name: "Longsword" }) !== null) {
    throw new Error("Mutagens, potions, decoctions and bombs must resolve to their curated local images.");
  }

  for (const foundryPath of new Set(CURATED_ITEM_IMAGE_PATHS.values())) {
    const relativePath = foundryPath.replace(`systems/${system.id}/`, "");
    if (!await exists(path.join(workspace, relativePath))) {
      throw new Error(`Missing curated item image: ${relativePath}`);
    }
  }
}

function validateCraftingRecipes() {
  const physical = { type: "diagrams", name: "Dagger", system: { quantity: 1, learned: false } };
  const memorized = { type: "diagrams", name: "Dagger", system: { quantity: 0, learned: true } };
  const unavailable = { type: "diagrams", name: "Dagger", system: { quantity: 0, learned: false } };
  const stored = { type: "diagrams", name: "Dagger", system: { quantity: 1, learned: false, isStored: true } };

  if (!hasPhysicalRecipe(physical)
    || hasPhysicalRecipe(memorized)
    || !canCraftFromRecipe(memorized)
    || canCraftFromRecipe(unavailable)
    || canCraftFromRecipe(stored)) {
    throw new Error("Invalid physical or memorized recipe availability.");
  }

  if (getRecipeOutputQuantity({ system: { outputQuantity: 3 } }) !== 3
    || getRecipeOutputQuantity({ system: { outputQuantity: 0 } }) !== 1) {
    throw new Error("Invalid crafted recipe output quantity.");
  }

  if (getRecipeMemoryCapacity({ stats: { int: { current: 7 } }, recipeMemoryBonus: 2 }) !== 9) {
    throw new Error("Invalid recipe memory capacity.");
  }

  const memorizedRecipes = [
    { ...memorized, system: { ...memorized.system, associatedItemUuid: "Item.dagger" } },
    { ...memorized, system: { ...memorized.system, associatedItemUuid: "Item.dagger" } },
    { type: "diagrams", name: "Swallow", system: { quantity: 0, learned: true, isFormulae: true } },
    physical,
  ];
  if (getMemorizedRecipeCount(memorizedRecipes) !== 2) {
    throw new Error("Memorized recipes must be counted once per recipe.");
  }
}

function validateApplicationTabs() {
  const listeners = new Map();
  let nextHookId = 0;
  const hooks = {
    on(name, callback) {
      const hookId = ++nextHookId;
      listeners.set(hookId, { name, callback });
      return hookId;
    },
    off(name, hookId) {
      if (listeners.get(hookId)?.name === name) listeners.delete(hookId);
    },
  };
  const activations = [];
  const app = {
    constructor: { name: "WitcherMountSheet" },
    rendered: false,
    changeTab(tabName, group, options) {
      activations.push(`${group}:${tabName}:${options.force}`);
    },
  };

  if (!prepareApplicationTab(app, "loadout", hooks) || activations.length !== 0) {
    throw new Error("A transport tab must not be activated before its sheet is rendered.");
  }

  const registeredHook = [...listeners.values()][0];
  registeredHook?.callback({});
  if (activations.length !== 0 || listeners.size !== 1) {
    throw new Error("A transport tab render hook must ignore other sheet instances.");
  }

  registeredHook?.callback(app);
  if (activations.join(",") !== "primary:loadout:true" || listeners.size !== 0) {
    throw new Error("A transport tab must activate once its sheet has rendered.");
  }

  app.rendered = true;
  prepareApplicationTab(app, "description", hooks);
  if (activations.join(",") !== "primary:loadout:true,primary:description:true" || listeners.size !== 0) {
    throw new Error("An already-rendered transport sheet must switch tabs immediately.");
  }
}

async function validateApplicationV2Migration(moduleFiles) {
  const forbiddenApis = [
    "ActorSheetV1",
    "ItemSheetV1",
    "DialogV1",
    "ApplicationV1",
    "renderV1Application",
    "appv1",
  ];

  for (const file of moduleFiles) {
    const source = await fs.readFile(file, "utf8");
    for (const api of forbiddenApis) {
      if (source.includes(api)) {
        throw new Error(`Application V1 API ${api} remains in ${path.relative(workspace, file)}.`);
      }
    }
  }

  const compatibilitySource = await fs.readFile(
    path.join(workspace, "module", "setup", "foundry-compat.js"),
    "utf8",
  );
  const requiredV2Definitions = [
    "class extends HandlebarsApplicationMixin(Base)",
    "export class WitcherActorSheetV2 extends",
    "export class WitcherItemSheetV2 extends",
    "export class WitcherDialog extends DialogV2",
  ];
  if (requiredV2Definitions.some(definition => !compatibilitySource.includes(definition))) {
    throw new Error("Actor, Item and Dialog compatibility classes must remain on the Application V2 API.");
  }
  if (!compatibilitySource.includes('classes: ["witcher", "sheet", "themed", "theme-light"]')) {
    throw new Error("Application V2 document sheets must explicitly retain the light parchment theme used by the former V1 sheets.");
  }
  if (!compatibilitySource.includes("return this.document?.name ?? super.title;")) {
    throw new Error("Application V2 document sheets must use the document name as their window title.");
  }

  const monsterSheetSource = await fs.readFile(
    path.join(workspace, "module", "actor", "sheets", "WitcherMonsterSheet.js"),
    "utf8",
  );
  const sheetStylesSource = await fs.readFile(
    path.join(workspace, "styles", "system-styles.css"),
    "utf8",
  );
  if (!monsterSheetSource.includes('classes: ["monster"]')
    || !sheetStylesSource.includes(".witcher.sheet.actor.monster")
    || !monsterSheetSource.includes("width: 1180")
    || !monsterSheetSource.includes("height: 860")
    || !sheetStylesSource.includes("min-width: 1180px")) {
    throw new Error("The monster Application V2 sheet must not shrink below its three-column layout width.");
  }
  if (!sheetStylesSource.includes("table:not(.monster-info)")
    || !sheetStylesSource.includes("tbody.item:nth-of-type(odd)")
    || !sheetStylesSource.includes('input[type="checkbox"]:disabled:checked')) {
    throw new Error("Application V2 sheets must retain compact striped tables and legible read-only checkboxes.");
  }

  const tabTemplates = [
    ["templates/sheets/actor/character-sheet.hbs", ["skills", "profession", "inventory", "magic", "background"]],
    ["templates/sheets/actor/monster-sheet.hbs", ["skills", "inventory", "details", "spells"]],
    ["templates/sheets/mount-sheet.hbs", ["description", "attributes", "loadout"]],
  ];
  for (const [relativePath, tabNames] of tabTemplates) {
    const source = await fs.readFile(path.join(workspace, relativePath), "utf8");
    const tabControls = source.match(/<a\b[^>]*>/g) ?? [];
    for (const tabName of tabNames) {
      const control = tabControls.find(tag => tag.includes(`data-tab="${tabName}"`));
      if (!control?.includes('data-action="tab"') || !control.includes('data-group="primary"')) {
        throw new Error(`Application V2 tab ${tabName} is not fully configured in ${relativePath}.`);
      }
    }
  }
}

function validateDocumentUpdates() {
  const accessories = ["Actor.character.Item.saddle"];
  const update = flattenDocumentUpdate({
    name: "Jacuś",
    system: {
      description: "Horse",
      accessories,
    },
  }, {
    "system.cargo": ["Actor.character.Item.sword"],
  });
  if (update.name !== "Jacuś"
    || update["system.description"] !== "Horse"
    || update["system.accessories"] !== accessories
    || update["system.cargo"][0] !== "Actor.character.Item.sword"
    || "system" in update) {
    throw new Error("Document sheet updates must preserve fields omitted from nested system form data.");
  }

  const transportUpdate = buildTransportDocumentUpdate({
    "system.hpCurrent": 55,
  }, {
    pullerId: "horse-id",
    accessories: ["Actor.character.Item.saddle"],
    cargo: ["Actor.character.Item.sword"],
  });
  if (transportUpdate["system.hpCurrent"] !== 55
    || transportUpdate["system.pullerId"] !== "horse-id"
    || transportUpdate["system.accessories"][0] !== "Actor.character.Item.saddle"
    || transportUpdate["system.cargo"][0] !== "Actor.character.Item.sword") {
    throw new Error("Partial transport updates must preserve the pulling animal and stored Items.");
  }

  const detachedTransport = buildTransportDocumentUpdate({
    "system.pullerId": "",
  }, {
    pullerId: "horse-id",
  });
  if (detachedTransport["system.pullerId"] !== "") {
    throw new Error("An explicit pulling-animal change must override the preserved transport relation.");
  }

  const containerUpdate = buildContainerDocumentUpdate({
    system: { capacity: 25 },
  }, {
    content: ["Actor.character.Item.rope"],
  });
  if (containerUpdate["system.capacity"] !== 25
    || containerUpdate["system.content"].join(",") !== "Actor.character.Item.rope") {
    throw new Error("Container sheet updates must preserve stored Item references.");
  }
}

function validateInventoryDrops() {
  const actor = { uuid: "Actor.character" };
  const otherActor = { documentName: "Actor", uuid: "Actor.other" };
  if (getItemDropSource({ parent: actor }, actor) !== "external") {
    throw new Error("An Item parent without an Actor document type must be treated as an external source.");
  }

  actor.documentName = "Actor";
  if (getItemDropSource({ parent: actor }, actor) !== "sameActor"
    || getItemDropSource({ parent: otherActor }, actor) !== "otherActor"
    || getItemDropSource({ parent: null, pack: "thewitchertrpg.gear" }, actor) !== "external") {
    throw new Error("Inventory drops must distinguish actor-owned Items from compendium templates.");
  }

  const visibleSaddle = {
    name: "Racing Saddle",
    type: "valuable",
    system: { isStored: false, quantity: 1 },
  };
  const storedSaddle = {
    name: "Racing Saddle",
    type: "valuable",
    system: { isStored: true, quantity: 1 },
  };
  const sourceSaddle = { name: "Racing Saddle", type: "valuable" };
  if (findStackableInventoryItem([storedSaddle, visibleSaddle], sourceSaddle) !== visibleSaddle
    || findStackableInventoryItem([storedSaddle], sourceSaddle) !== null
    || findStackableInventoryItem([], { name: "Backpack", type: "container" }) !== null
    || findStackableInventoryItem([{ name: "Horse", type: "mount", system: {} }], {
      name: "Horse",
      type: "mount",
    }) !== null) {
    throw new Error("Imported Items must not stack into stored equipment or transports.");
  }

  if (findStackableStoredItem([visibleSaddle, storedSaddle], sourceSaddle) !== storedSaddle
    || findStackableStoredItem([visibleSaddle], sourceSaddle) !== null
    || findStackableStoredItem([{ ...storedSaddle, type: "container" }], {
      ...sourceSaddle,
      type: "container",
    }) !== null) {
    throw new Error("Cargo drops must merge into a matching stored stack without stacking containers.");
  }

  const split = getSingleItemTransfer(2);
  const single = getSingleItemTransfer(1);
  const partialStack = getItemQuantityTransfer(100, 37);
  const entireStack = getItemQuantityTransfer(100, 200);
  if (split.remaining !== 1 || split.transferred !== 1
    || single.remaining !== 0 || single.transferred !== 1
    || partialStack?.remaining !== 63 || partialStack?.transferred !== 37
    || entireStack?.remaining !== 0 || entireStack?.transferred !== 100
    || getItemQuantityTransfer(100, 0) !== null
    || findStackableInventoryItem([visibleSaddle], storedSaddle) !== visibleSaddle) {
    throw new Error("Inventory stacks must transfer the requested quantity and merge into visible Items.");
  }

  if (calculateItemStackWeight(100, 0.1) !== 10
    || calculateItemStackWeight(3, 0.1) !== 0.3) {
    throw new Error("Grouped cargo must expose an exact total stack weight without floating-point noise.");
  }
}

async function validateContainerStorage() {
  const legacySatchel = {
    name: "Satchel",
    type: "valuable",
    system: {
      type: "containers",
      quantity: 1,
      weight: 1,
      cost: 14,
      description: "A shoulder bag.",
    },
  };
  const importedSatchel = prepareContainerItemSource(legacySatchel);
  if (!isContainerItem(legacySatchel)
    || importedSatchel.type !== "container"
    || importedSatchel.system.type !== undefined
    || importedSatchel.system.quantity !== "1"
    || importedSatchel.system.weight !== 1
    || importedSatchel.system.cost !== 14
    || importedSatchel.system.description !== "A shoulder bag."
    || importedSatchel.system.capacity !== 30
    || importedSatchel.system.content.length !== 0
    || legacySatchel.type !== "valuable") {
    throw new Error("Legacy compendium containers must import as real container Items.");
  }
  if (getKnownContainerCapacity({ name: "Basket", system: {} }) !== 15
    || getKnownContainerCapacity({ name: "Sack", system: {} }) !== 20
    || getKnownContainerCapacity({ name: "Sheath, Bow", system: {} }) !== null
    || getKnownContainerCapacity({ name: "Satchel", system: { capacity: 35 } }) !== 35) {
    throw new Error("Known container capacities must follow the compendium descriptions.");
  }
  const partialContainerUpdate = migrateContainerSystemData({ isStored: true });
  const completeContainerSource = migrateContainerSystemData({
    quantity: 4,
    carry: 30,
    capacity: null,
    content: ["item", "item", ""],
  });
  if (Object.hasOwn(partialContainerUpdate, "content")
    || Object.hasOwn(partialContainerUpdate, "quantity")
    || completeContainerSource.quantity !== "1"
    || completeContainerSource.capacity !== 30
    || completeContainerSource.content.join(",") !== "item") {
    throw new Error("Partial container updates must never clear or replace omitted contents.");
  }
  let migrationUpdates = [];
  const forcedReplacements = [];
  const migratedCount = await migrateLegacyContainerItems({
    items: [
      { id: "legacy-satchel", ...legacySatchel },
      { id: "existing-basket", name: "Basket", type: "container", system: { capacity: null } },
    ],
    async updateEmbeddedDocuments(documentName, updates) {
      if (documentName !== "Item") throw new Error("Unexpected embedded document type.");
      migrationUpdates = updates;
    },
  }, system => {
    const replacement = { operator: "ForcedReplacement", value: system };
    forcedReplacements.push(replacement);
    return replacement;
  });
  if (migratedCount !== 2
    || migrationUpdates[0]?._id !== "legacy-satchel"
    || migrationUpdates[0]?.type !== "container"
    || migrationUpdates[0]?.system !== forcedReplacements[0]
    || migrationUpdates[0]?.system?.operator !== "ForcedReplacement"
    || migrationUpdates[0]?.system?.value?.capacity !== 30
    || migrationUpdates[1]?._id !== "existing-basket"
    || migrationUpdates[1]?.["system.capacity"] !== 15) {
    throw new Error("Existing actor-owned legacy containers must migrate in place.");
  }

  const rope = {
    id: "rope",
    uuid: "Actor.character.Item.rope",
    type: "valuable",
    system: { quantity: 2, weight: 1.5, isStored: true },
  };
  const potion = {
    id: "potion",
    uuid: "Actor.character.Item.potion",
    type: "alchemical",
    system: { quantity: 10, weight: 0.5, isStored: false },
  };
  const backpack = {
    id: "backpack",
    uuid: "Actor.character.Item.backpack",
    type: "container",
    system: {
      quantity: 1,
      weight: 1,
      capacity: 5,
      content: [rope.uuid],
    },
  };
  const state = getContainerState(backpack, [rope]);
  const update = buildContainerStorageUpdate([rope.uuid, rope.uuid, "", null]);
  if (normalizeContainerCapacity(0) !== null
    || normalizeContainerCapacity("20") !== 20
    || calculateContainerContentWeight([rope]) !== 3
    || state.weight !== 3
    || state.remaining !== 2
    || state.overloaded
    || getContainerTransferLimit(backpack, [rope], potion) !== 4
    || update["system.content"].join(",") !== rope.uuid) {
    throw new Error("Container capacity, weight or content normalization is invalid.");
  }

  const mount = {
    id: "horse",
    uuid: "Actor.character.Item.horse",
    type: "mount",
    system: { accessories: [], cargo: [backpack.uuid] },
  };
  const actorItems = [mount, backpack, rope];
  if (calculateCarriedInventoryWeight([backpack, rope]) !== 4
    || calculateCarriedInventoryWeight(actorItems) !== 0
    || calculateStoredItemsWeight([backpack], actorItems) !== 4) {
    throw new Error("Portable container contents must follow the correct encumbrance owner.");
  }

  const deletionOrder = [];
  const sourceActor = {
    uuid: "Actor.source",
    documentName: "Actor",
    items: new Map(),
  };
  const sourceContent = {
    id: "source-rope",
    uuid: "Actor.source.Item.source-rope",
    type: "valuable",
    parent: sourceActor,
    system: { quantity: 1, weight: 1, isStored: true },
    toObject: () => ({
      _id: "source-rope",
      name: "Rope",
      type: "valuable",
      system: { quantity: 1, weight: 1, isStored: true },
    }),
    delete: async () => deletionOrder.push("content"),
  };
  const sourceContainer = {
    id: "source-satchel",
    uuid: "Actor.source.Item.source-satchel",
    type: "container",
    parent: sourceActor,
    system: { quantity: 1, capacity: 30, content: [sourceContent.uuid], isStored: false },
    toObject: () => ({
      _id: "source-satchel",
      name: "Satchel",
      type: "container",
      system: { quantity: 1, capacity: 30, content: [sourceContent.uuid], isStored: false },
    }),
    delete: async () => deletionOrder.push("container"),
  };
  sourceActor.items.set(sourceContent.id, sourceContent);
  sourceActor.items.set(sourceContainer.id, sourceContainer);

  let createdSources = [];
  let transferUpdates = [];
  const targetActor = {
    uuid: "Actor.target",
    documentName: "Actor",
    async createEmbeddedDocuments(documentName, sources) {
      if (documentName !== "Item") throw new Error("Unexpected embedded document type.");
      createdSources = sources;
      return sources.map((source, index) => ({
        id: `created-${index}`,
        uuid: `Actor.target.Item.created-${index}`,
      }));
    },
    async updateEmbeddedDocuments(documentName, updates) {
      if (documentName !== "Item") throw new Error("Unexpected embedded document type.");
      transferUpdates = updates;
    },
  };
  const moved = await moveContainerBetweenActors(
    sourceContainer,
    targetActor,
    uuid => uuid === sourceContent.uuid ? sourceContent : null,
  );
  if (!moved
    || createdSources.length !== 2
    || createdSources[0].system.content.length !== 0
    || createdSources[1].system.isStored !== false
    || transferUpdates[0]?.["system.content"]?.[0] !== "Actor.target.Item.created-1"
    || transferUpdates[1]?.["system.isStored"] !== true
    || deletionOrder.join(",") !== "content,container") {
    throw new Error("Moving a container between Actors must preserve and re-link its contents.");
  }
}

function validateStoredItems() {
  const mounted = {
    id: "mounted",
    uuid: "Actor.character.Item.mounted",
    type: "valuable",
    system: { isStored: true },
  };
  const contained = {
    id: "contained",
    uuid: "Actor.character.Item.contained",
    type: "weapon",
    system: { isStored: true },
  };
  const orphaned = {
    id: "orphaned",
    uuid: "Actor.character.Item.orphaned",
    type: "valuable",
    system: { isStored: true },
  };
  const unmarked = {
    id: "unmarked",
    uuid: "Actor.character.Item.unmarked",
    type: "valuable",
    system: { isStored: false },
  };
  const mount = {
    type: "mount",
    system: { accessories: [mounted.uuid], cargo: [] },
  };
  const container = {
    id: "satchel",
    uuid: "Actor.character.Item.satchel",
    type: "container",
    system: { content: [contained.id, unmarked.uuid], isStored: true },
  };
  mount.system.cargo.push(container.uuid);
  const storedDocuments = [mounted, contained, orphaned, unmarked, mount, container];
  const result = findOrphanedStoredItems(storedDocuments);
  if (result.length !== 1 || result[0] !== orphaned) {
    throw new Error("Only stored Items without a mount or container reference may be restored.");
  }
  const unmarkedResult = findUnmarkedStoredItems(storedDocuments);
  if (unmarkedResult.length !== 1 || unmarkedResult[0] !== unmarked) {
    throw new Error("Referenced Items without a stored flag must be synchronized.");
  }

  const actor = { uuid: "Actor.character" };
  const owned = { id: "mounted", uuid: mounted.uuid, parent: actor };
  const foreign = { uuid: "Actor.other.Item.foreign", parent: { uuid: "Actor.other" } };
  const documents = new Map([[owned.uuid, owned], [foreign.uuid, foreign]]);
  actor.items = new Map([[owned.id, owned]]);
  const resolved = resolveActorOwnedItems(
    [owned.uuid, foreign.uuid, "Actor.character.Item.missing"],
    actor,
    uuid => documents.get(uuid) ?? null,
  );
  if (resolved.length !== 1 || resolved[0] !== owned) {
    throw new Error("Transport storage must ignore unresolved and foreign Actor Item references.");
  }

  const legacyResolved = resolveActorOwnedItems([owned.id], actor, () => null);
  if (legacyResolved.length !== 1 || legacyResolved[0] !== owned) {
    throw new Error("Stored Item resolution must support legacy Actor Item IDs.");
  }
}

function validateTransport() {
  const partialTransportUpdate = migrateTransportSystemData({ hpCurrent: 55 });
  const cargoTransportUpdate = migrateTransportSystemData({
    accessories: ["saddle"],
    cargo: ["satchel"],
  });
  const completeTransportSource = migrateTransportSystemData({
    description: "Occupancy: 2\nImprovement Slots: 3\nSP: 4",
    pullerId: null,
    accessories: null,
    cargo: null,
  });
  if (Object.hasOwn(partialTransportUpdate, "pullerId")
    || Object.hasOwn(partialTransportUpdate, "accessories")
    || Object.hasOwn(partialTransportUpdate, "cargo")
    || Object.hasOwn(cargoTransportUpdate, "pullerId")
    || cargoTransportUpdate.accessories[0] !== "saddle"
    || cargoTransportUpdate.cargo[0] !== "satchel"
    || completeTransportSource.kind !== "wagon"
    || completeTransportSource.occupancy !== 2
    || completeTransportSource.improvementSlots !== 3
    || completeTransportSource.sp !== 4
    || completeTransportSource.pullerId !== ""
    || completeTransportSource.accessories.length !== 0
    || completeTransportSource.cargo.length !== 0) {
    throw new Error("Partial transport updates must preserve puller and storage relations.");
  }

  const horse = {
    name: "Horse",
    type: "mount",
    system: { dex: "11", control: "+2", speed: "12", hp: 40, hpCurrent: null },
  };
  const wagon = {
    name: "War Wagon",
    type: "mount",
    system: {
      dex: "N/A",
      control: "-2",
      speed: "Animal's -5",
      hp: 100,
      description: "Occupancy: 0\nImprovement Slots: 4\nSP: 0",
    },
  };
  const ship = { name: "Sailing Ship", type: "mount", system: { dex: "N/A", speed: "8" } };

  if (inferTransportKind(horse) !== "mount"
    || inferTransportKind(wagon) !== "wagon"
    || inferTransportKind(ship) !== "waterVehicle"
    || getTransportControlSkill(ship) !== "sailing"
    || getTransportControlSkill(wagon) !== "riding") {
    throw new Error("Legacy transport kinds or control skills are not inferred correctly.");
  }

  const wagonDetails = parseLegacyTransportDetails(wagon.system.description);
  if (wagonDetails.occupancy !== 0
    || wagonDetails.improvementSlots !== 4
    || wagonDetails.sp !== 0) {
    throw new Error("Legacy wagon statistics are not parsed correctly.");
  }

  const racingSaddle = { name: "Racing Saddle", system: {} };
  const chainBarding = { name: "Chain Barding", system: {} };
  const saddlebags = { name: "Saddlebags", system: {} };
  const derivedHorse = getTransportDerivedStats(horse, [racingSaddle, chainBarding, saddlebags]);
  if (derivedHorse.control !== 2
    || derivedHorse.speed !== "13"
    || derivedHorse.sp !== 15
    || derivedHorse.hp.value !== 40
    || derivedHorse.hp.max !== 40
    || derivedHorse.cargoCapacity !== 50
    || getTransportAccessoryProfile(chainBarding).slot !== "barding") {
    throw new Error("Transport accessory bonuses are not calculated correctly.");
  }

  const horseWithoutStorage = getTransportDerivedStats(horse);
  if (horseWithoutStorage.cargoCapacity !== 0) {
    throw new Error("Mounts without storage equipment must not accept cargo.");
  }
  if (getTransportDerivedStats(wagon).cargoCapacity !== null) {
    throw new Error("Vehicles without a rules-defined capacity must keep a GM-managed limit.");
  }

  const cargo = [{ system: { quantity: 5, weight: 10 } }];
  const storedCargo = getTransportCargoState(horse, [saddlebags], cargo);
  const strandedCargo = getTransportCargoState(horse, [], cargo);
  const gmManagedCargo = getTransportCargoState(wagon, [], cargo);
  if (storedCargo.weight !== 50 || storedCargo.overloaded
    || !strandedCargo.blocked || !strandedCargo.overloaded || strandedCargo.capacity !== 0
    || gmManagedCargo.overloaded || gmManagedCargo.capacity !== null) {
    throw new Error("Cargo must be unloaded when removing equipment makes transport capacity insufficient.");
  }

  const pulledWagon = getTransportDerivedStats(wagon, [], horse);
  if (!usesPullingAnimalSpeed(wagon) || pulledWagon.speed !== "7") {
    throw new Error("Vehicle speed must be calculated from the selected pulling animal.");
  }

  const equipmentUpdate = buildTransportStorageUpdate(
    { accessories: ["Item.saddle"], cargo: ["Item.food"] },
    "accessories",
    ["Item.saddle", "Item.barding"],
  );
  const cargoUpdate = buildTransportStorageUpdate(
    { accessories: equipmentUpdate["system.accessories"], cargo: equipmentUpdate["system.cargo"] },
    "cargo",
    ["Item.food", "Item.rope"],
  );
  if (cargoUpdate["system.accessories"].length !== 2
    || cargoUpdate["system.cargo"].length !== 2) {
    throw new Error("Updating transport equipment and cargo must preserve both collections.");
  }
  const reverseEquipmentUpdate = buildTransportStorageUpdate(
    { accessories: ["Item.saddle"], cargo: cargoUpdate["system.cargo"] },
    "accessories",
    ["Item.saddle", "Item.barding"],
  );
  if (reverseEquipmentUpdate["system.accessories"].length !== 2
    || reverseEquipmentUpdate["system.cargo"].length !== 2) {
    throw new Error("Updating cargo and then transport equipment must preserve both collections.");
  }

  const storedWeapon = {
    id: "stored-weapon",
    uuid: "Actor.character.Item.stored-weapon",
    type: "weapon",
    system: { quantity: 1, weight: 8, isStored: true },
  };
  const storedValuable = {
    id: "stored-valuable",
    uuid: "Actor.character.Item.stored-valuable",
    type: "valuable",
    system: { quantity: 1, weight: 50, isStored: true },
  };
  const carriedWeight = calculateCarriedInventoryWeight([
    {
      ...horse,
      system: {
        ...horse.system,
        quantity: 1,
        weight: 100,
        accessories: [storedValuable.uuid],
        cargo: [storedWeapon.uuid],
      },
    },
    { ...wagon, system: { ...wagon.system, quantity: 1, weight: 400 } },
    { type: "valuable", system: { quantity: 2, weight: 3 } },
    storedWeapon,
    storedValuable,
  ]);
  if (carriedWeight !== 6) {
    throw new Error("Transport and stored cargo must not count toward personal encumbrance.");
  }

  const damage = resolveTransportDamage({ currentHp: 40, maxHp: 40, sp: 10, damage: 25 });
  if (damage.absorbedDamage !== 10 || damage.hpDamage !== 15 || damage.remainingHp !== 25) {
    throw new Error("Transport damage does not apply SP correctly.");
  }
  if (getTransportRepairRequirement(25, 40)?.dc !== 10
    || getTransportRepairRequirement(10, 40)?.dc !== 14
    || getTransportRepairRequirement(40, 40) !== null) {
    throw new Error("Transport repair requirements are not selected correctly.");
  }
}

function validateCriticalWoundThresholds() {
  const cases = [
    [Number.NaN, null, 0],
    [-1, null, 0],
    [0, null, 0],
    [6, null, 0],
    [7, "Simple", 3],
    [9, "Simple", 3],
    [10, "Complex", 5],
    [12, "Complex", 5],
    [13, "Difficult", 8],
    [14, "Difficult", 8],
    [15, "Deadly", 10],
    [30, "Deadly", 10],
  ];

  for (const [margin, expectedKey, expectedBonusDamage] of cases) {
    const criticalWound = getCriticalWound(margin);
    if ((criticalWound?.key ?? null) !== expectedKey || (criticalWound?.bonusDamage ?? 0) !== expectedBonusDamage) {
      throw new Error(`Invalid critical wound classification for margin ${margin}.`);
    }
  }
}

function validateCriticalWoundLocations() {
  const locations = [
    ["Head", "Head", 11, 12],
    ["Torso", "Torso", 6, 9],
    ["R. Arm", "Arm", 4, 4],
    ["L. Arm", "Arm", 4, 4],
    ["R. Leg", "Leg", 2, 2],
    ["L. Leg", "Leg", 2, 2],
    ["Tail/Wing", null, null, null],
  ];

  for (const [location, expectedLocation, lesserTarget, greaterTarget] of locations) {
    if (getCriticalWoundLocation(location) !== expectedLocation
      || getCriticalWoundResultTarget(location, 4) !== lesserTarget
      || getCriticalWoundResultTarget(location, 5) !== greaterTarget) {
      throw new Error(`Invalid critical wound location mapping for ${location}.`);
    }
  }

  const effects = [
    ["Simple", 2, "SimpleSprainedLeg"],
    ["Simple", 4, "SimpleSprainedArm"],
    ["Simple", 6, "SimpleForeignObject"],
    ["Simple", 9, "SimpleCrackedRibs"],
    ["Simple", 11, "SimpleDisfiguringScar"],
    ["Simple", 12, "SimpleCrackedJaw"],
    ["Complex", 2, "ComplexFracturedLeg"],
    ["Complex", 4, "ComplexFracturedArm"],
    ["Complex", 6, "ComplexBrokenRibs"],
    ["Complex", 9, "ComplexRupturedSpleen"],
    ["Complex", 11, "ComplexLostTeeth"],
    ["Complex", 12, "ComplexMinorHeadWound"],
    ["Difficult", 2, "DifficultCompoundLegFracture"],
    ["Difficult", 4, "DifficultCompoundArmFracture"],
    ["Difficult", 6, "DifficultSuckingChestWound"],
    ["Difficult", 9, "DifficultTornStomach"],
    ["Difficult", 11, "DifficultConcussion"],
    ["Difficult", 12, "DifficultSkullFracture"],
    ["Deadly", 2, "DeadlyDismemberedLeg"],
    ["Deadly", 4, "DeadlyDismemberedArm"],
    ["Deadly", 6, "DeadlySepticShock"],
    ["Deadly", 9, "DeadlyHearthDamage"],
    ["Deadly", 11, "DeadlyDamagedEye"],
    ["Deadly", 12, "DeadlyDecapitated"],
  ];
  for (const [tier, target, expectedEffect] of effects) {
    if (getCriticalWoundEffect(tier, target)?.effect !== expectedEffect) {
      throw new Error(`Invalid ${tier} critical wound effect for target ${target}.`);
    }
  }

  const tableTargets = [[2, 2], [3, 2], [4, 4], [5, 4], [6, 6], [8, 6], [9, 9], [10, 9], [11, 11], [12, 12]];
  for (const [roll, expectedTarget] of tableTargets) {
    if (getCriticalWoundTableTarget(roll) !== expectedTarget) {
      throw new Error(`Invalid critical wound table target for roll ${roll}.`);
    }
  }
}

function validateDamageResourceUpdates() {
  const nonLethal = buildDamageResourceUpdate("sta", 30, 6, 10);
  if (nonLethal?.appliedDamage !== 16
    || nonLethal.remaining !== 14
    || nonLethal.updates["system.derivedStats.sta.value"] !== 14
    || "system.derivedStats.hp.value" in nonLethal.updates) {
    throw new Error("Non-lethal critical damage must be applied entirely to STA.");
  }

  const lethal = buildDamageResourceUpdate("hp", 30, 6, 10);
  if (lethal?.appliedDamage !== 16
    || lethal.remaining !== 14
    || lethal.updates["system.derivedStats.hp.value"] !== 14
    || "system.derivedStats.sta.value" in lethal.updates) {
    throw new Error("Lethal critical damage must be applied entirely to HP.");
  }

  if (shouldApplyCriticalWound("sta", 10)
    || !shouldApplyCriticalWound("hp", 10)
    || shouldApplyCriticalWound("hp", 0)) {
    throw new Error("Critical wounds must only be applied for lethal damage with a critical bonus.");
  }
}

function validateSpellResolution() {
  const legacyFireStream = {
    name: "Fire Stream",
    system: { defence: "Dodge or Block" },
  };
  if (getEffectiveSpellDefence(legacyFireStream) !== "Dodge or Block"
    || getEffectiveSpellDefence({ name: "Ice Slick", system: { defence: "Dodge" } }) !== "Reposition"
    || getEffectiveSpellDefence({
      name: "Renamed Ice",
      flags: { core: { sourceId: "Compendium.thewichertrpg.magic.Item.jwH48vEXIVhn1YCj" } },
      system: { defence: "Dodge" },
    }) !== "Reposition"
    || getEffectiveSpellDefence({ name: "Talfryn's Prison", system: { defence: "Dodge" } }) !== "Dodge/Escape only"
    || getEffectiveSpellDefence({ name: "Igni", system: { defence: "Dodge" } }) !== "Dodge"
    || getSpellDefenceActions("Dodge or Block").join(",") !== "Reposition,Dodge,Block"
    || getSpellDefenceActions("Dodge").join(",") !== "Reposition,Dodge"
    || getSpellDefenceActions("Dodge/Escape only").join(",") !== "Dodge"
    || getSpellDefenceActions("Reposition").join(",") !== "Reposition"
    || getSpellDefenceActions("Resist Magic or Dodge").join(",") !== "MagicResist,Reposition,Dodge"
    || getSpellDefenceActions("Spell Casting").join(",") !== "SpellCasting"
    || hasSpellDefenceRoll("None")
    || !hasSpellDefenceRoll("Resist Magic")) {
    throw new Error("Invalid spell defence action resolution.");
  }

  const buttons = {
    Dodge: { label: "Dodge" },
    Reposition: { label: "Reposition" },
    Block: { label: "Block" },
    MagicResist: { label: "Resist Magic" },
  };
  const restricted = restrictDefenceButtons(buttons, "Dodge or Block");
  const fireStreamDefence = restrictDefenceButtons(buttons, getEffectiveSpellDefence(legacyFireStream));
  if (Object.keys(restricted).join(",") !== "Reposition,Dodge,Block"
    || Object.keys(fireStreamDefence).join(",") !== "Reposition,Dodge,Block"
    || restrictDefenceButtons(buttons, "") !== buttons) {
    throw new Error("Spell defence dialog must contain only permitted actions.");
  }

  if (shouldResolveAttackCriticalWound({ isSpell: true, hasDamage: false })
    || !shouldResolveAttackCriticalWound({ isSpell: true, hasDamage: true })
    || !shouldResolveAttackCriticalWound({ isSpell: false, hasDamage: false })) {
    throw new Error("Non-damaging spells must never resolve critical wounds or critical damage.");
  }

  const fireStreamFormula = getSpellDamageFormulaDisplay("1d6/STA", "4d6", {
    isVariable: true,
    staminaSpent: 4,
  });
  if (!fireStreamFormula.scalesWithStamina
    || fireStreamFormula.total !== "4d6"
    || fireStreamFormula.base !== "1d6"
    || fireStreamFormula.stamina !== 4) {
    throw new Error("Variable spell damage must expose its resolved STA-scaled formula.");
  }

  if (!shouldApplyDamageEffects("hp", 0, { applyEffectsOnHit: true })
    || shouldApplyDamageEffects("sta", 0, { applyEffectsOnHit: true })
    || shouldApplyDamageEffects("hp", 0, {})
    || !shouldApplyDamageEffects("hp", 1, {})) {
    throw new Error("Spell status effects must apply on a successful zero-damage hit only when requested.");
  }
}

async function validateSpellBuffs() {
  const quen = {
    id: "owned-quen",
    uuid: "Actor.caster.Item.owned-quen",
    name: "Quen",
    img: "quen.webp",
    flags: { core: { sourceId: "Compendium.thewitchertrpg.magic.Item.y1ckoIaGIVqwvvkC" } },
    system: {
      createsShield: false,
      shield: "",
      staminaIsVar: true,
      duration: "10 Rounds",
    },
  };
  const quenDefinition = getSpellShieldDefinition(quen);
  if (quenDefinition?.durationRounds !== 10
    || getSpellShieldFormula(quenDefinition, 3) !== "15"
    || getSpellShieldDefinition({ name: "Unknown", system: {} }) !== null) {
    throw new Error("Quen must expose its rulebook shield value without relying on missing compendium flags.");
  }

  const configured = getSpellShieldDefinition({
    id: "custom-shield",
    name: "Custom Shield",
    system: { createsShield: true, shield: "1d6/STA", staminaIsVar: true, duration: "3 rounds" },
  });
  if (configured?.durationRounds !== 3 || getSpellShieldFormula(configured, 3) !== "3d6") {
    throw new Error("Configured shield spells must scale their formulas and duration with spell data.");
  }

  const effects = new Map();
  const actor = {
    id: "caster",
    uuid: "Actor.caster",
    name: "Geralt",
    flags: {},
    effects,
    system: { derivedStats: { shield: { value: 0 } } },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = JSON.parse(JSON.stringify(value));
    },
    async unsetFlag(scope, key) {
      delete this.flags?.[scope]?.[key];
    },
    async update(changes) {
      if (changes["system.derivedStats.shield.value"] !== undefined) {
        this.system.derivedStats.shield.value = Number(changes["system.derivedStats.shield.value"]);
      }
    },
    async createEmbeddedDocuments(documentName, documents) {
      if (documentName !== "ActiveEffect") throw new Error("Unexpected embedded document type.");
      return documents.map((data, index) => {
        const id = `effect-${effects.size + index + 1}`;
        const effect = {
          ...data,
          id,
          parent: this,
          getFlag(scope, key) {
            return this.flags?.[scope]?.[key];
          },
          async delete() {
            effects.delete(id);
          },
        };
        effects.set(id, effect);
        return effect;
      });
    },
  };
  const combat = { id: "combat", round: 2, turn: 0, combatant: { id: "caster-turn", actor } };
  const applied = await applySpellShieldBuff(actor, quen, {
    staminaSpent: 3,
    combat,
    announce: false,
  });
  if (!applied.applied
    || applied.value !== 15
    || actor.system.derivedStats.shield.value !== 15
    || effects.size !== 1
    || getActorSpellShield(actor)?.remainingRounds !== 10) {
    throw new Error("Casting Quen must immediately create a 5 HP per STA tracked shield buff.");
  }

  const recast = await applySpellShieldBuff(actor, quen, { staminaSpent: 1, combat, announce: false });
  if (recast.applied || recast.reason !== "active" || actor.system.derivedStats.shield.value !== 15) {
    throw new Error("Quen must not be cast again while its shield is active.");
  }

  const sameTurn = getSpellShieldTurnPlan(getActorSpellShield(actor), combat);
  const nextTurn = getSpellShieldTurnPlan(getActorSpellShield(actor), {
    ...combat,
    round: 3,
    combatant: { id: "caster-turn", actor },
  });
  if (sameTurn.process || !sameTurn.appliedThisTurn || !nextTurn.process || nextTurn.remainingRounds !== 9) {
    throw new Error("A finite spell buff must not consume a round when cast and must advance on later caster turns.");
  }

  await actor.setFlag("thewitchertrpg", "spellShield", {
    ...getActorSpellShield(actor),
    remainingRounds: 1,
  });
  const expiry = await processCurrentCombatantSpellBuffs({
    ...combat,
    round: 3,
    combatant: { id: "caster-turn", actor },
  });
  if (!expiry?.expired
    || actor.system.derivedStats.shield.value !== 0
    || getActorSpellShield(actor)
    || effects.size !== 0) {
    throw new Error("Quen must automatically remove its shield and active effect after its final round.");
  }

  await applySpellShieldBuff(actor, quen, { staminaSpent: 2, combat, announce: false });
  await clearSpellShieldBuff(actor, { announce: false });
  if (actor.system.derivedStats.shield.value !== 0 || getActorSpellShield(actor) || effects.size !== 0) {
    throw new Error("Removing a spell shield buff must clear both its shield value and active effect.");
  }

  const itemMixinSource = await fs.readFile(
    path.join(workspace, "module", "actor", "mixins", "itemMixin.js"),
    "utf8",
  );
  const systemSource = await fs.readFile(path.join(workspace, "module", "TheWitcherTRPG.js"), "utf8");
  if (!itemMixinSource.includes("await applySpellShieldBuff(this.actor, spellItem")
    || !itemMixinSource.includes("canApplySpellShieldBuff(this.actor, spellShieldDefinition)")
    || !systemSource.includes("registerSpellBuffHooks();")) {
    throw new Error("Spell shield application and lifecycle hooks must be wired into the Foundry runtime.");
  }
}

async function validateDefenceDialogLayout() {
  const actionsSource = await fs.readFile(
    path.join(workspace, "module", "scripts", "actions.js"),
    "utf8",
  );
  const stylesSource = await fs.readFile(
    path.join(workspace, "styles", "system-styles.css"),
    "utf8",
  );
  if (!actionsSource.includes('classes: ["dialog", "witcher-defence-dialog"]')
    || !actionsSource.includes("width: Math.min(760")
    || !stylesSource.includes(".witcher-defence-dialog .dialog-buttons")
    || !stylesSource.includes("flex-wrap: wrap")) {
    throw new Error("The defence dialog must remain wide, resizable, and wrap every action button.");
  }
}

function validateRollRerolls() {
  const flag = createRollRerollFlag({
    formula: "1d10+10",
    baseFlavor: "Defence",
    success: false,
    config: {
      showResult: true,
      defence: true,
      threshold: 20,
      showCrit: true,
      showSuccess: true,
      rerollData: {
        kind: "defence",
        sourceAttackMessageId: "attack",
        targetActorUuid: "Actor.target",
      },
      flagsOnFailure: {
        thewitchertrpg: {
          damageResolution: { state: "ready" },
          defenceResolution: { margin: 10 },
          preservedFlag: { value: true },
        },
      },
    },
  });
  const restored = applySerializedRollConfig({}, flag.config);
  const chain = getNextRerollChain(flag, "defence");
  if (flag?.kind !== "defence"
    || flag.formula !== "1d10+10"
    || restored.threshold !== 20
    || restored.flagsOnFailure?.thewitchertrpg?.damageResolution
    || restored.flagsOnFailure?.thewitchertrpg?.defenceResolution
    || restored.flagsOnFailure?.thewitchertrpg?.preservedFlag?.value !== true
    || chain.rootMessageId !== "defence"
    || chain.count !== 1
    || !getRollRerollAvailability({ reroll: flag }).allowed
    || getRollRerollAvailability({ reroll: flag, damageState: "rolled" }).allowed
    || getRollRerollAvailability({ reroll: flag, areaTargetState: "applied" }).allowed
    || getRollRerollAvailability({ reroll: { ...flag, state: "superseded" } }).allowed) {
    throw new Error("Roll rerolls must preserve their conflict context and lock after resolution starts.");
  }

  const sideEffectConfig = {
    showResult: true,
    showSuccess: true,
    onResolved: () => {},
  };
  if (createRollRerollFlag({
    formula: "1d10",
    config: sideEffectConfig,
    success: true,
  }) !== null) {
    throw new Error("Generic tests with immediate side effects must not expose an unsafe reroll.");
  }
}

async function validateRollRerollWiring() {
  const source = await fs.readFile(path.join(workspace, "module", "scripts", "chat.js"), "utf8");
  const spellAreaImport = source.match(/import\s*{([\s\S]*?)}\s*from\s*["']\.\/spellArea\.mjs["'];?/);
  const importedNames = spellAreaImport?.[1]
    ?.split(",")
    .map(name => name.trim())
    .filter(Boolean) ?? [];
  if (!importedNames.includes("updateSpellAreaTargetDefence")
    || !source.includes("await updateSpellAreaTargetDefence(")
    || !source.includes("function cloneData(value)")) {
    throw new Error("Area defence rerolls must import their synchronization and define their data cloning helper.");
  }
}

function validateSpellAreas() {
  if (normalizeSpellAreaSize("6m") !== 6
    || normalizeSpellAreaSize("20,5 m") !== 20.5
    || normalizeSpellAreaSize("0") !== null
    || normalizeSpellAreaSize("none") !== null) {
    throw new Error("Spell area sizes must accept localized values and reject invalid sizes.");
  }

  const duration = buildSpellAreaDurationData("5 Rounds", { id: "combat", round: 3 });
  const untrackedDuration = buildSpellAreaDurationData("5 Rounds");
  const activeDuration = getSpellAreaExpirationState(duration, { id: "combat", round: 7 });
  const expiredDuration = getSpellAreaExpirationState(duration, { id: "combat", round: 8 });
  if (parseSpellAreaDurationRounds("5 rund") !== 5
    || parseSpellAreaDurationRounds("Immediate") !== null
    || duration.startRound !== 3
    || duration.expirationRound !== 8
    || untrackedDuration.expirationRound !== null
    || activeDuration.expired
    || activeDuration.remainingRounds !== 1
    || !expiredDuration.expired) {
    throw new Error("Spell area durations must expire after the configured number of combat rounds.");
  }

  const yrdenAtOne = buildPersistentSpellAreaEffect({
    name: "Yrden",
    img: "yrden.webp",
    system: { effect: "Magic circle" },
  }, { staminaSpent: 1 });
  const yrdenAtSeven = buildPersistentSpellAreaEffect({ name: "Yrden", system: {} }, { staminaSpent: 7 });
  const igniEffect = buildPersistentSpellAreaEffect({ name: "Igni", system: {} }, { staminaSpent: 7 });
  if (yrdenAtOne?.penalty !== 1
    || yrdenAtOne.excludeCaster !== true
    || yrdenAtOne.stats.map(stat => stat.modifier).join(",") !== "-1,-1"
    || yrdenAtSeven?.penalty !== 4
    || igniEffect !== null) {
    throw new Error("Persistent spell areas must derive the correct Yrden penalty from stamina spent.");
  }

  const cone = buildSpellAreaShape("cone", 600, { rotation: 90, gridPixels: 100 });
  const ray = buildSpellAreaShape("ray", 800, { rotation: 45, gridPixels: 100 });
  const circle = buildSpellAreaShape("circle", 400, { gridPixels: 100 });
  if (cone?.type !== "cone" || cone.radius !== 600 || cone.rotation !== 90
    || ray?.type !== "rectangle" || ray.width !== 800 || ray.height !== 100
    || circle?.type !== "circle" || circle.radius !== 400) {
    throw new Error("Spell area shapes must preserve their dimensions and rotation.");
  }

  const casterActor = { uuid: "Actor.caster", name: "Caster" };
  const targetActor = { uuid: "Actor.target", name: "Target" };
  const region = {
    tokens: new Set(),
    flags: {
      thewitchertrpg: {
        spellArea: {
          actorUuid: casterActor.uuid,
          casterTokenUuid: "Scene.scene.Token.caster",
          persistentEffect: yrdenAtOne,
        },
      },
    },
    parent: {
      tokens: [{
        uuid: "Scene.scene.Token.caster",
        name: "Caster",
        actor: casterActor,
        texture: { src: "caster.webp" },
        testInsideRegion: () => true,
      }, {
        uuid: "Scene.scene.Token.target",
        name: "Target",
        actor: targetActor,
        texture: { src: "target.webp" },
        testInsideRegion: () => true,
      }, {
        uuid: "Scene.scene.Token.outside",
        name: "Outside",
        actor: { uuid: "Actor.outside", name: "Outside" },
        testInsideRegion: () => false,
      }],
    },
  };
  const detectedTargets = collectSpellAreaTargets(region, { actor: casterActor });
  if (detectedTargets.length !== 1
    || detectedTargets[0]?.actorUuid !== targetActor.uuid
    || isExcludedSpellAreaCaster(region, region.parent.tokens[1])
    || !isExcludedSpellAreaCaster(region, region.parent.tokens[0])
    || detectedTargets.some(target => target.name === "Outside")) {
    throw new Error("Spell area targets must exclude the caster and ignore tokens outside the Region.");
  }

  const area = createSpellAreaResolution({
    region: { id: "region", uuid: "Scene.scene.Region.region" },
    casterToken: { document: { uuid: "Scene.scene.Token.caster" } },
    spell: { uuid: "Actor.actor.Item.spell", name: "Igni" },
    targets: [{
      tokenUuid: "Scene.scene.Token.target",
      actorUuid: "Actor.target",
      name: "Target",
      img: "target.webp",
    }],
    attackTotal: 20,
    defence: "Dodge or Block",
    hasDefence: true,
    hasDamage: true,
  });
  const hitArea = updateSpellAreaTargetData(area, "Scene.scene.Token.target", {
    state: "hit",
    defenceResolution: { margin: 8 },
  });
  const resolvedArea = {
    ...hitArea,
    targets: hitArea.targets.map(target => ({ ...target, state: "applied" })),
  };
  if (isSpellAreaResolutionComplete(hitArea)
    || !isSpellAreaResolutionComplete(resolvedArea)
    || !isSpellAreaResolutionComplete({ ...area, targets: [] })
    || isSpellAreaResolutionComplete({ ...resolvedArea, ended: true })) {
    throw new Error("Transient spell areas must finish only after every target reaches a final state.");
  }
  const i18n = {
    localize: key => key,
    format: (key, data) => `${key}:${data.margin}`,
  };
  const rendered = renderSpellAreaResolution({ ...hitArea, ...untrackedDuration }, i18n);
  const sanitizedRendered = rendered
    .replace("<!-- witcher-spell-area-start -->", "")
    .replace("<!-- witcher-spell-area-end -->", "");
  const replaced = replaceSpellAreaResolution(`before${sanitizedRendered}${sanitizedRendered}after`, {
    ...hitArea,
    targets: hitArea.targets.map(target => ({ ...target, state: "applied" })),
  }, i18n);
  if (area.targets[0].state !== "pending"
    || hitArea.targets[0].state !== "hit"
    || !rendered.includes("spell-area-damage")
    || !rendered.includes("WITCHER.SpellArea.Hit:8")
    || (replaced.match(/witcher-spell-area-start/g)?.length ?? 0) !== 1
    || (replaced.match(/spell-area-resolution/g)?.length ?? 0) !== 1
    || !replaced.includes("is-applied")
    || !rendered.includes('class="spell-area-end')
    || !rendered.includes("WITCHER.SpellArea.DurationManual")) {
    throw new Error("Spell area target state and chat rendering must remain synchronized.");
  }
  const endedRendered = renderSpellAreaResolution({ ...hitArea, ended: true, endReason: "expired" }, i18n);
  if (endedRendered.includes('class="spell-area-end')
    || endedRendered.includes("spell-area-damage")
    || !endedRendered.includes("WITCHER.SpellArea.Expired")) {
    throw new Error("Ended spell areas must disable chat actions and show their final state.");
  }
}

async function validateDeathSaves() {
  const deathSave = getSaveDetails({ hp: -4, stun: 3, body: 8, will: 6, deathSaves: 2 });
  if (!deathSave.isDeathSave
    || deathSave.base !== 7
    || deathSave.penalty !== 2
    || deathSave.threshold !== 5) {
    throw new Error("Death Saves must use unmodified STUN and the accumulated penalty.");
  }

  const zeroHpSave = getSaveDetails({ hp: 0, stun: 6, body: 8, will: 6, deathSaves: 0 });
  if (!zeroHpSave.isDeathSave
    || getUpdatedHpValue({ "system.derivedStats.hp.value": 0 }) !== 0
    || getUpdatedHpValue({ system: { derivedStats: { hp: { value: -3 } } } }) !== -3
    || parseHpInputValue("0") !== 0
    || parseHpInputValue("-3") !== -3
    || parseHpInputValue(5) !== 5
    || parseHpInputValue("") !== null) {
    throw new Error("An actor at 0 HP must use a Death Save.");
  }

  const stunSave = getSaveDetails({ hp: 1, stun: 6, body: 8, will: 6, deathSaves: 4 });
  if (stunSave.isDeathSave || stunSave.base !== 6 || stunSave.penalty !== 0 || stunSave.threshold !== 6) {
    throw new Error("Stun Saves must not use the Death Save penalty.");
  }

  const impossibleSave = getSaveDetails({ hp: -1, stun: 6, body: 4, will: 4, deathSaves: 9 });
  if (impossibleSave.threshold !== 0
    || normalizeLuckSpend(3, 2) !== 2
    || normalizeLuckSpend(-1, 2) !== 0) {
    throw new Error("Death Save targets and Luck spending must remain within valid bounds.");
  }

  const survived = resolveDeathSave({ isDeathSave: true, success: true, deathSaves: 2 });
  const died = resolveDeathSave({ isDeathSave: true, success: false, deathSaves: 2 });
  if (survived.deathSaves !== 3
    || survived.deathSaveFailed
    || died.deathSaves !== 2
    || !died.deathSaveFailed) {
    throw new Error("Death Save outcomes must increase the penalty on success and record death on failure.");
  }

  const changes = { system: { derivedStats: { hp: { value: 5 } } } };
  if (!resetDeathSavesAfterRecovery(changes)
    || changes["system.deathSaves"] !== 0
    || changes["system.deathSaveFailed"] !== false) {
    throw new Error("Recovering above 0 HP must reset the Death Save sequence.");
  }

  const handlers = {};
  let recalculationOptions = null;
  let recalculationCount = 0;
  registerDeathSaveHooks({
    on: (event, handler) => { handlers[event] = handler; },
  }, (_actor, options) => {
    recalculationCount += 1;
    recalculationOptions = options;
  });

  handlers.updateActor({}, { "system.derivedStats.hp.value": 0 }, {}, null);
  await Promise.resolve();
  handlers.updateActor({}, { "system.derivedStats.hp.value": 0 }, recalculationOptions, null);
  if (recalculationCount !== 1 || !recalculationOptions?.witcherHpDerivedRecalculation) {
    throw new Error("An HP update must trigger exactly one marked derived-stat recalculation.");
  }
}

async function validateVerbalDamageResourceUpdates() {
  const depleted = buildVerbalDamageResourceUpdate(3, 5);
  if (depleted?.resolveBefore !== 3
    || depleted.rolledDamage !== 5
    || depleted.appliedDamage !== 3
    || depleted.remainingResolve !== 0
    || !depleted.defeated
    || depleted.updates["system.derivedStats.resolve.value"] !== 0) {
    throw new Error("Verbal damage must stop Resolve at 0 and report only the applied damage.");
  }

  const remaining = buildVerbalDamageResourceUpdate(10, 4);
  if (remaining?.appliedDamage !== 4 || remaining.remainingResolve !== 6 || remaining.defeated) {
    throw new Error("Verbal damage must preserve remaining Resolve when it is not depleted.");
  }

  const repaired = buildVerbalDamageResourceUpdate(-2, 4);
  if (repaired?.resolveBefore !== 0 || repaired.remainingResolve !== 0 || repaired.appliedDamage !== 0) {
    throw new Error("Existing negative Resolve values must be normalized to 0.");
  }

  if (buildVerbalDamageResourceUpdate("invalid", 4) !== null) {
    throw new Error("Invalid Resolve values must not produce a verbal damage update.");
  }

  const originalGame = globalThis.game;
  const updates = [];
  globalThis.game = {
    user: { id: "gm", isGM: true },
    users: { activeGM: { id: "gm" } },
  };
  try {
    const updatedActors = await normalizeNegativeResolveValues([
      {
        _source: { system: { derivedStats: { resolve: { value: -2 } } } },
        async update(update) { updates.push(update); },
      },
      {
        _source: { system: { derivedStats: { resolve: { value: 4 } } } },
        async update(update) { updates.push(update); },
      },
    ]);
    if (updatedActors !== 1
      || updates.length !== 1
      || updates[0]["system.derivedStats.resolve.value"] !== 0) {
      throw new Error("Stored negative Resolve values must be normalized when the system starts.");
    }
  } finally {
    if (originalGame === undefined) delete globalThis.game;
    else globalThis.game = originalGame;
  }
}

async function validateCriticalWoundApplication() {
  const damage = {
    defenceResolution: {
      targetActorUuid: "Actor.target",
      bonusDamage: 8,
      criticalResult: {
        tier: "Difficult",
        target: 4,
        effect: "DifficultCompoundArmFracture",
      },
    },
  };
  const updates = [];
  const actor = {
    uuid: "Actor.target",
    system: {
      critWounds: [{ id: "existing", effect: "SimpleCrackedJaw", mod: "None" }],
    },
    async update(update) {
      updates.push(update);
      this.system.critWounds = update["system.critWounds"];
    },
  };

  const record = buildCriticalWoundRecord(damage, actor, () => "critical-id");
  const applied = await applyDamageCriticalWound(actor, damage, () => "critical-id");
  if (record?.effect !== "DifficultCompoundArmFracture"
    || getCriticalWoundBonusDamage(damage, actor) !== 8
    || applied?.id !== "critical-id"
    || updates.length !== 1
    || actor.system.critWounds.length !== 2
    || actor.system.critWounds[1].mod !== "None") {
    throw new Error("Invalid actor critical wound application.");
  }

  if (buildCriticalWoundRecord(damage, { uuid: "Actor.other" }, () => "wrong-target") !== null) {
    throw new Error("Critical wounds must only be applied to the defending actor.");
  }
  if (getCriticalWoundBonusDamage(damage, { uuid: "Actor.other" }) !== 0) {
    throw new Error("Critical wound bonus damage must only be applied to the defending actor.");
  }
}

async function validateCriticalWoundEffects() {
  const wound = {
    id: "septic-shock-id",
    effect: "DeadlySepticShock",
    mod: "None",
    notes: "",
    daysHealed: 0,
    healingTime: 0,
  };
  const mechanics = getCriticalWoundMechanics(wound.effect, wound.mod);
  if (mechanics.stats.length !== 4
    || mechanics.stats.find(entry => entry.stat === "WITCHER.Actor.Stat.Int")?.modifier !== "-3"
    || mechanics.derived.find(entry => entry.derivedStat === "WITCHER.Actor.DerStat.Sta")?.modifier !== "/4"
    || mechanics.statuses.join(",") !== "poison") {
    throw new Error("Invalid Septic Shock critical wound mechanics.");
  }

  let generatedId = 0;
  let legacyDeleted = false;
  let recalculated = 0;
  const legacyCriticalEffect = {
    id: "legacy-critical-effect",
    type: "effect",
    flags: {
      thewitchertrpg: {
        criticalWoundId: wound.id,
        appliedByCriticalWound: true,
      },
    },
    async delete() {
      legacyDeleted = true;
      actor.items = actor.items.filter(candidate => candidate !== this);
    },
  };
  const actor = {
    system: {
      critWounds: [wound],
      statusEffectImmunities: [],
      stats: { body: { max: 8, current: 8 } },
    },
    statuses: new Set(),
    items: [legacyCriticalEffect],
    async toggleStatusEffect(statusId, { active }) {
      if (active) this.statuses.add(statusId);
      else this.statuses.delete(statusId);
    },
    async createEmbeddedDocuments(type, entries) {
      if (type !== "Item") throw new Error("Unexpected embedded document type.");
      const created = entries.map(entry => {
        const item = {
          ...entry,
          id: `critical-item-${this.items.length + 1}`,
          parent: this,
          getFlag(scope, key) {
            return this.flags?.[scope]?.[key];
          },
          async update(update) { Object.assign(this, update); },
          async delete() {
            actor.items = actor.items.filter(candidate => candidate !== this);
          },
        };
        return item;
      });
      this.items.push(...created);
      return created;
    },
    async update(update) {
      if (update["system.critWounds"] !== undefined) {
        this.system.critWounds = update["system.critWounds"];
      }
    },
  };
  const options = {
    idFactory: () => `critical-effect-modifier-${++generatedId}`,
    localize: value => value,
    statusEffectOptions: {
      statusEffects: [{ id: "poison", label: "Poison", icon: "icons/svg/poison.svg" }],
      idFactory: () => `status-effect-modifier-${++generatedId}`,
      localize: value => value,
      effectTemplates: [],
    },
  };

  const modifierSources = getCriticalWoundModifierSources(actor, { localize: value => value });
  if (modifierSources.length !== 1
    || modifierSources[0].id !== wound.id
    || modifierSources[0].system.stats.length !== 4
    || modifierSources[0].system.derived[0]?.modifier !== "/4") {
    throw new Error("Critical wounds must provide modifiers without an Active Effect item.");
  }

  await applyCriticalWoundConsequences(actor, wound, options);
  const poisonItem = actor.items.find(item => item.getFlag?.("thewitchertrpg", "statusEffectId") === "poison");
  if (!poisonItem
    || !actor.statuses.has("poison")
    || actor.items.some(item => item !== legacyCriticalEffect && item.flags?.thewitchertrpg?.criticalWoundId)) {
    throw new Error("Applying a critical wound must apply statuses without creating a duplicate wound effect.");
  }

  wound.mod = "Stabilized";
  await synchronizeCriticalWoundEffects(actor, {
    ...options,
    async recalculateActor() { recalculated += 1; },
  });
  const stabilizedSource = getCriticalWoundModifierSources(actor, { localize: value => value })[0];
  if (!legacyDeleted
    || recalculated !== 1
    || stabilizedSource.system.stats.some(entry => entry.modifier !== "-1")
    || stabilizedSource.system.derived[0]?.modifier !== "/2") {
    throw new Error("Stabilizing a critical wound must update direct modifiers and remove legacy duplicates.");
  }

  wound.mod = "None";
  actor.statuses.clear();
  actor.items = actor.items.filter(item => item.getFlag?.("thewitchertrpg", "statusEffectId") !== "poison");
  await synchronizeCriticalWoundEffects(actor, options);
  if (!actor.statuses.has("poison")
    || !actor.items.some(item => item.getFlag?.("thewitchertrpg", "statusEffectId") === "poison")) {
    throw new Error("Synchronizing a manually edited critical wound must apply its native statuses.");
  }
  actor.system.critWounds = [];
  await synchronizeCriticalWoundEffects(actor, options);
  if (getCriticalWoundModifierSources(actor).length !== 0) {
    throw new Error("Removing a Crit Wounds entry must remove its direct modifiers.");
  }
}

function validateCriticalWoundHealing() {
  const tableCases = [
    ["SimpleCrackedJaw", 3, 5],
    ["SimpleCrackedJaw", 8, 1],
    ["ComplexBrokenRibs", 3, 9],
    ["ComplexBrokenRibs", 13, 1],
    ["DifficultConcussion", 10, 5],
    ["DifficultConcussion", 13, 2],
    ["DeadlySepticShock", 3, 0],
    ["DeadlySepticShock", 13, 0],
    ["DeadlyDecapitated", 8, 0],
  ];
  for (const [effect, body, expected] of tableCases) {
    if (getCriticalWoundHealingTime(effect, body) !== expected) {
      throw new Error(`Invalid critical wound healing time for ${effect} at BODY ${body}.`);
    }
  }

  const untreated = {
    id: "untreated",
    effect: "SimpleCrackedJaw",
    mod: "None",
    daysHealed: 0,
    healingTime: 0,
  };
  const treated = {
    id: "treated",
    effect: "ComplexBrokenRibs",
    mod: "Treated",
    daysHealed: 0,
    healingTime: 0,
  };
  const initialized = initializeCriticalWoundHealing([untreated, treated], 8);
  if (!initialized.changed
    || initialized.wounds[0].healingTime !== 0
    || initialized.wounds[1].healingTime !== 4) {
    throw new Error("Only treated critical wounds may start their healing countdown.");
  }

  const firstDay = advanceCriticalWoundHealing(initialized.wounds, 8);
  if (firstDay.wounds.find(wound => wound.id === "untreated")?.daysHealed !== 0
    || firstDay.wounds.find(wound => wound.id === "treated")?.daysHealed !== 1
    || firstDay.healed.length !== 0) {
    throw new Error("Critical wound healing progress must advance only for treated wounds.");
  }

  const finalDay = advanceCriticalWoundHealing([{
    ...treated,
    daysHealed: 3,
    healingTime: 4,
  }], 8);
  if (finalDay.wounds.length !== 0 || finalDay.healed[0]?.id !== "treated") {
    throw new Error("Critical wounds must be removed after their final healing day.");
  }

  const permanentWound = advanceCriticalWoundHealing([{
    id: "permanent",
    effect: "DeadlySepticShock",
    mod: "Treated",
    daysHealed: 9,
    healingTime: 10,
  }], 8);
  if (permanentWound.wounds[0]?.daysHealed !== 0
    || permanentWound.wounds[0]?.healingTime !== 0
    || permanentWound.healed.length !== 0) {
    throw new Error("Deadly critical wounds must keep permanent penalties without a healing countdown.");
  }
}

async function validateDamageEffects() {
  const preparedEffects = prepareDamageEffects([
    { name: "Bleed", statusEffect: null, percentage: 75 },
    { name: "Burning", statusEffect: null, percentage: 50 },
    { name: "Knockdown", statusEffect: null, percentage: 100 },
    { name: "Stun (INT)", statusEffect: null, percentage: 0 },
    { name: "Narrative effect", statusEffect: null, percentage: 0 },
  ], [
    { id: "bleed", name: "WITCHER.statusEffects.bleed" },
    { id: "fire", name: "WITCHER.statusEffects.fire" },
    { id: "prone", name: "WITCHER.statusEffects.prone" },
    { id: "stun", name: "WITCHER.statusEffects.stun" },
  ], value => ({
    "WITCHER.statusEffects.bleed": "Bleed",
    "WITCHER.statusEffects.fire": "Fire",
  })[value] ?? value);

  if (preparedEffects[0].statusEffect !== "bleed"
    || preparedEffects[1].statusEffect !== "fire"
    || preparedEffects[2].statusEffect !== "prone"
    || preparedEffects[3].statusEffect !== "stun"
    || preparedEffects[4].statusEffect != null) {
    throw new Error("Invalid legacy damage status effect matching.");
  }

  const rolls = [76, 75];
  const resolvedEffects = resolveDamageEffects([
    { name: "Failed bleed", statusEffect: "bleed", percentage: 75 },
    { name: "Successful fire", statusEffect: "fire", percentage: 75 },
    { name: "Automatic poison", statusEffect: "poison", percentage: 0 },
    { name: "Duplicate poison", statusEffect: "poison", percentage: 0 },
  ], () => rolls.shift());

  if (resolvedEffects[0].success !== false
    || resolvedEffects[0].roll !== 76
    || resolvedEffects[1].success !== true
    || resolvedEffects[1].roll !== 75
    || resolvedEffects[2].success !== true
    || resolvedEffects[2].roll !== null) {
    throw new Error("Invalid damage effect percentage resolution.");
  }

  const successfulStatuses = getSuccessfulStatusEffectIds({ resolvedEffects });
  if (successfulStatuses.join(",") !== "fire,poison") {
    throw new Error("Invalid successful damage status effect selection.");
  }

  if (getSuccessfulStatusEffectIds({ effects: resolvedEffects }).length !== 0) {
    throw new Error("Unresolved damage effects must not be applied.");
  }

  const toggledStatuses = [];
  const actor = {
    statuses: new Set(["poison"]),
    system: { statusEffectImmunities: [] },
    async toggleStatusEffect(statusId, { active }) {
      toggledStatuses.push([statusId, active]);
      if (active) this.statuses.add(statusId);
      else this.statuses.delete(statusId);
    },
  };
  const applicationResults = await applySuccessfulDamageStatusEffects(actor, { resolvedEffects });
  if (toggledStatuses.length !== 1
    || toggledStatuses[0].join(",") !== "fire,true"
    || !actor.statuses.has("fire")
    || applicationResults.find(result => result.statusId === "poison")?.alreadyActive !== true) {
    throw new Error("Invalid damage status effect application.");
  }

  const statusDefinitions = [{
    id: "freeze",
    name: "WITCHER.statusEffects.freeze",
    img: "icons/svg/frozen.svg",
    systemEffect: {
      description: "WITCHER.statusEffectDescriptions.freeze",
      stats: [
        { stat: "WITCHER.Actor.Stat.Ref", modifier: "-1" },
        { stat: "WITCHER.Actor.Stat.Spd", modifier: "-3" },
      ],
    },
  }];
  const freezeDamage = {
    resolvedEffects: [{ name: "Freeze", statusEffect: "freeze", percentage: 100, roll: 1, success: true }],
  };
  let generatedId = 0;
  const itemData = buildDamageStatusEffectItemData("freeze", freezeDamage, statusDefinitions, {
    idFactory: () => `modifier-${++generatedId}`,
    localize: value => ({
      "WITCHER.statusEffects.freeze": "Freeze",
      "WITCHER.statusEffectDescriptions.freeze": "Frozen description",
    })[value] ?? value,
  });
  if (itemData.name !== "Freeze"
    || itemData.type !== "effect"
    || itemData.system.isActive !== true
    || itemData.system.stats.length !== 2
    || itemData.system.stats[1].stat !== "WITCHER.Actor.Stat.Spd"
    || itemData.system.stats[1].modifier !== "-3") {
    throw new Error("Invalid damage Active Effect item data.");
  }

  const createdItems = [];
  const effectActor = {
    statuses: new Set(),
    items: [],
    system: { statusEffectImmunities: [] },
    async toggleStatusEffect(statusId, { active }) {
      if (active) this.statuses.add(statusId);
      else this.statuses.delete(statusId);
    },
    async createEmbeddedDocuments(type, entries) {
      if (type !== "Item") throw new Error("Unexpected embedded document type.");
      const created = entries.map(entry => ({
        ...entry,
        id: `item-${createdItems.length + 1}`,
        getFlag: (scope, key) => entry.flags?.[scope]?.[key],
      }));
      this.items.push(...created);
      createdItems.push(...created);
      return created;
    },
  };
  const effectOptions = {
    statusEffects: statusDefinitions,
    idFactory: () => `effect-modifier-${++generatedId}`,
    localize: value => value === "WITCHER.statusEffects.freeze" ? "Freeze" : value,
    effectTemplates: [],
  };
  await applySuccessfulDamageStatusEffects(effectActor, freezeDamage, effectOptions);
  await applySuccessfulDamageStatusEffects(effectActor, freezeDamage, effectOptions);
  if (createdItems.length !== 1
    || createdItems[0].flags.thewitchertrpg.statusEffectId !== "freeze"
    || createdItems[0].system.stats.length !== 2) {
    throw new Error("Damage status effects must create one reusable Active Effect item.");
  }

  const linkedUpdates = [];
  const existingEffect = {
    name: "Freeze",
    type: "effect",
    system: { isActive: true },
    flags: {},
    getFlag: () => null,
    async update(update) {
      linkedUpdates.push(update);
    },
  };
  effectActor.items = [existingEffect];
  effectActor.statuses.add("freeze");
  await applySuccessfulDamageStatusEffects(effectActor, freezeDamage, effectOptions);
  if (linkedUpdates.length !== 1
    || linkedUpdates[0]["flags.thewitchertrpg.statusEffectId"] !== "freeze"
    || linkedUpdates[0]["flags.thewitchertrpg.appliedByDamage"] !== true) {
    throw new Error("Reused Active Effect items must be linked to their native status.");
  }

  await validateDamageEffectDeletionSync();
}

async function validateDamageEffectDeletionSync() {
  const toggledStatuses = [];
  const actor = {
    statuses: new Set(["bleed"]),
    items: [],
    async toggleStatusEffect(statusId, { active }) {
      toggledStatuses.push([statusId, active]);
      if (active) this.statuses.add(statusId);
      else this.statuses.delete(statusId);
    },
  };
  const linkedItem = {
    id: "linked-bleed",
    type: "effect",
    parent: actor,
    flags: { thewitchertrpg: { statusEffectId: "bleed" } },
    async delete() {
      actor.items = actor.items.filter(item => item !== this);
    },
  };
  const manualItem = {
    id: "manual-effect",
    type: "effect",
    parent: actor,
    flags: {},
    async delete() {
      throw new Error("Unlinked Active Effect item must not be deleted.");
    },
  };
  actor.items = [linkedItem, manualItem];

  const removedNativeStatus = await synchronizeDeletedDamageEffectItem(linkedItem);
  if (!removedNativeStatus
    || actor.statuses.has("bleed")
    || toggledStatuses.length !== 1
    || toggledStatuses[0].join(",") !== "bleed,false") {
    throw new Error("Deleting a linked Active Effect item must remove its native status.");
  }

  actor.statuses.add("bleed");
  const deletedItemIds = await synchronizeDeletedNativeStatusEffect({
    parent: actor,
    statuses: new Set(["bleed"]),
  });
  if (deletedItemIds.join(",") !== "linked-bleed"
    || actor.items.length !== 1
    || actor.items[0] !== manualItem) {
    throw new Error("Deleting a native status must remove only its linked Active Effect item.");
  }
}

async function validateOngoingStatusEffects() {
  if (parseStatusDurationRounds("5 Rounds") !== 5
    || parseStatusDurationRounds("3 rundy") !== 3
    || parseStatusDurationRounds("Immediate") !== null
    || parseStatusDurationRounds(0) !== null) {
    throw new Error("Status effect durations must accept numeric English and Polish round values.");
  }

  const duration = getDamageStatusDurationRounds("poison", {
    duration: "7 rounds",
    resolvedEffects: [{ statusEffect: "poison", durationRounds: 4 }],
  });
  if (duration !== 4) {
    throw new Error("A status-specific duration must take precedence over its source spell duration.");
  }

  const target = { id: "target" };
  const applicationCombat = { id: "combat", round: 2, turn: 1, combatant: target };
  const lifecycle = buildInitialStatusLifecycle("bleed", applicationCombat, { durationRounds: 2, appliedAt: 1 });
  if (getStatusTurnPlan("bleed", lifecycle, applicationCombat).process !== false) {
    throw new Error("An ongoing status must not tick immediately when applied during the target's turn.");
  }

  const nextTurn = { id: "combat", round: 3, turn: 1, combatant: target };
  const firstTick = getStatusTurnPlan("bleed", lifecycle, nextTurn);
  const secondTick = getStatusTurnPlan("bleed", {
    ...lifecycle,
    remainingRounds: firstTick.remainingRounds,
    lastProcessedTurnKey: firstTick.turnKey,
  }, { id: "combat", round: 4, turn: 1, combatant: target });
  if (!firstTick.tick
    || firstTick.remainingRounds !== 1
    || firstTick.expireAfterTick
    || secondTick.remainingRounds !== 0
    || !secondTick.expireAfterTick) {
    throw new Error("Finite ongoing statuses must tick once per affected turn and expire after their final round.");
  }

  const staggered = buildInitialStatusLifecycle("staggered", applicationCombat, { appliedAt: 1 });
  const staggerPlan = getStatusTurnPlan("staggered", staggered, nextTurn);
  if (!staggerPlan.expireBeforeTick || staggerPlan.remainingRounds !== 0) {
    throw new Error("Staggered must expire automatically at the beginning of the target's next turn.");
  }

  if (calculateStackedArmorSp(8, 12, 20) !== 29
    || resolveFireLocationDamage(5, 3) !== 2
    || resolveFireLocationDamage(5, 3, true) !== 1
    || resolveFireLocationDamage(5, 8) !== 0) {
    throw new Error("Ongoing fire damage must respect layered armor SP and fire resistance.");
  }
  if (getOngoingStatusDamage({
    system: { critWounds: [{ effect: "DeadlyHearthDamage", mod: "Treated" }] },
  }, "bleed", 2) !== 4) {
    throw new Error("A treated deadly heart wound must add its permanent bleeding damage.");
  }

  const actor = {
    id: "actor",
    uuid: "Actor.actor",
    name: "Target",
    statuses: new Set(["bleed"]),
    flags: {},
    items: [],
    system: { derivedStats: { hp: { value: 10 } } },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = JSON.parse(JSON.stringify(value));
    },
    async update(updates) {
      if (updates["system.derivedStats.hp.value"] !== undefined) {
        this.system.derivedStats.hp.value = updates["system.derivedStats.hp.value"];
      }
    },
    async toggleStatusEffect(statusId, { active }) {
      if (active) this.statuses.add(statusId);
      else this.statuses.delete(statusId);
    },
  };
  const liveCombat = { id: "combat", round: 1, turn: 0, combatant: { id: "actor-turn", actor } };
  const firstResolution = await processCurrentCombatantStatusEffects(liveCombat);
  const duplicateResolution = await processCurrentCombatantStatusEffects(liveCombat);
  liveCombat.round = 2;
  const nextResolution = await processCurrentCombatantStatusEffects(liveCombat);
  if (firstResolution[0]?.damage !== 2
    || duplicateResolution.length !== 0
    || nextResolution[0]?.damage !== 2
    || actor.system.derivedStats.hp.value !== 6) {
    throw new Error("Ongoing status damage must be applied exactly once at each affected turn start.");
  }
}

function validateStatusSkillModifiers() {
  const actor = {
    statuses: new Set(["staggered"]),
    system: { critWounds: [] },
    getList(type) {
      if (type !== "effect") return [];
      return [{
        name: "Staggered",
        type: "effect",
        flags: { thewitchertrpg: { statusEffectId: "staggered" } },
        system: {
          isActive: true,
          skills: [
            { skill: "WITCHER.SkRefDodge", modifier: "-2" },
            { skill: "WITCHER.SkRefMelee", modifier: "/2" },
          ],
        },
      }];
    },
  };
  const options = { displayRollDetails: false, localize: value => value };
  const dodgeModifiers = getActorSkillEffectModifiers(actor, { label: "WITCHER.SkRefDodge" }, options);
  const dodgeFormula = addActorSkillEffectModifiers(actor, "WITCHER.SkRefDodge", "1d10+12", options);
  const meleeFormula = addActorSkillEffectModifiers(actor, "WITCHER.SkRefMelee", "1d10+12", options);
  const unrelatedFormula = addActorSkillEffectModifiers(actor, "WITCHER.SkDexArchery", "1d10+12", options);
  const detailedFormula = addActorSkillEffectModifiers(actor, "WITCHER.SkRefDodge", "1d10+12", {
    ...options,
    displayRollDetails: true,
  });
  actor.statuses.delete("staggered");
  const expiredFormula = addActorSkillEffectModifiers(actor, "WITCHER.SkRefDodge", "1d10+12", options);
  if (dodgeModifiers.length !== 1
    || dodgeModifiers[0].source !== "Staggered"
    || dodgeFormula !== "1d10+12-2"
    || meleeFormula !== "1d10+12/2"
    || unrelatedFormula !== "1d10+12"
    || detailedFormula !== "1d10+12-2[Staggered]"
    || expiredFormula !== "1d10+12") {
    throw new Error("Active status skill modifiers must alter matching attack and defence formulas exactly once.");
  }

  if (isActorEffectItemActive(actor, actor.getList("effect")[0])) {
    throw new Error("A linked status item must stop modifying rolls as soon as its native status ends.");
  }
}

async function validateStatusSkillModifierWiring() {
  const itemMixinSource = await fs.readFile(
    path.join(workspace, "module", "actor", "mixins", "itemMixin.js"),
    "utf8",
  );
  const actionsSource = await fs.readFile(
    path.join(workspace, "module", "scripts", "actions.js"),
    "utf8",
  );
  const witcherSource = await fs.readFile(
    path.join(workspace, "module", "scripts", "witcher.js"),
    "utf8",
  );
  const itemApplications = itemMixinSource.match(/addActorSkillEffectModifiers\(/g)?.length ?? 0;
  const defenceApplications = actionsSource.match(/addActorSkillEffectModifiers\(/g)?.length ?? 0;
  const hasMagicDefenceLabels = actionsSource.includes(
    'addActorSkillEffectModifiers(actor, "WITCHER.SkWillResistMagLable", rollFormula)',
  ) && actionsSource.includes(
    'addActorSkillEffectModifiers(actor, "WITCHER.SkWillSpellcastLable", rollFormula)',
  );
  const hasDirectSkillApplication = witcherSource.includes(
    "addActorSkillEffectModifiers(actor, skillMapEntry.label, rollFormula)",
  );
  if (itemApplications < 2
    || defenceApplications < 7
    || !hasMagicDefenceLabels
    || !hasDirectSkillApplication) {
    throw new Error("Status skill modifiers must be wired into weapon, spell, and every defence roll path.");
  }
}

async function validateCurrencyItems() {
  const crowns = {
    id: "legacy-crowns",
    name: "Crowns",
    type: "valuable",
    system: { quantity: "2" },
  };
  if (getCurrencyItemType(crowns) !== "crown"
    || getCurrencyItemType({ ...crowns, name: "Korony" }) !== "crown"
    || getCurrencyItemType({ ...crowns, name: "Crown", type: "weapon" }) !== null
    || getCurrencyItemType({
      name: "Marked coins",
      type: "valuable",
      system: { currencyType: "oren" },
    }) !== "oren") {
    throw new Error("Legacy currency items are not recognized correctly.");
  }

  const deposits = [];
  const deposit = await depositCurrencyItem({}, crowns, 2, "transfer", {
    applyChange: async (_actor, currency, amount, reason) => {
      deposits.push({ currency, amount, reason });
      return true;
    },
  });
  if (!deposit?.deposited
    || deposits.length !== 1
    || deposits[0].currency !== "crown"
    || deposits[0].amount !== 2
    || deposits[0].reason !== "transfer") {
    throw new Error("Currency item transfer must deposit its quantity in the ledger.");
  }

  let deleted = false;
  const formulaCrowns = {
    id: "formula-crowns",
    name: "Crowns",
    type: "valuable",
    system: { quantity: "3d10" },
    async delete() {
      throw new Error("Unrolled currency formulas must not be migrated.");
    },
  };
  const actor = {
    items: [{
      ...crowns,
      async delete() {
        deleted = true;
      },
    }, formulaCrowns],
  };
  const migrated = await migrateLegacyCurrencyItems(actor, "migration", {
    applyChange: async (_actor, currency, amount) => currency === "crown" && amount === 2,
  });
  if (!deleted
    || migrated.length !== 1
    || migrated[0].currency !== "crown"
    || migrated[0].amount !== 2) {
    throw new Error("Numeric legacy currency items must be migrated and removed.");
  }
}

function validateLocalizationPaths(translations, file) {
  const leafPaths = new Set();
  collectLocalizationLeafPaths(translations, "", leafPaths);

  for (const leafPath of leafPaths) {
    const segments = leafPath.split(".");
    for (let index = 1; index < segments.length; index++) {
      const parentPath = segments.slice(0, index).join(".");
      if (leafPaths.has(parentPath)) {
        throw new Error(`Conflicting localization paths in ${path.relative(workspace, file)}: ${parentPath} and ${leafPath}.`);
      }
    }
  }
}

async function validateSystemManifest() {
  if ("includes" in system) {
    throw new Error("Unsupported system.json key: includes.");
  }
  if (await exists(path.join(workspace, "template.json"))) {
    throw new Error("Legacy template.json must not be present; define Document types in system.json.");
  }

  for (const documentName of ["Actor", "Item"]) {
    const documentTypes = system.documentTypes?.[documentName];
    if (!documentTypes || Object.keys(documentTypes).length === 0) {
      throw new Error(`Missing system.json documentTypes.${documentName} definitions.`);
    }
  }
}

function collectLocalizationLeafPaths(value, parentPath, leafPaths) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectLocalizationLeafPaths(child, parentPath ? `${parentPath}.${key}` : key, leafPaths);
    }
    return;
  }

  leafPaths.add(parentPath);
}

async function validatePack(pack) {
  const source = path.resolve(workspace, pack.path);
  const destination = path.join(temporaryRoot, pack.name);
  await fs.cp(source, destination, {
    recursive: true,
    filter: (entry) => path.basename(entry) !== "LOCK",
  });

  const currentPath = path.join(destination, "CURRENT");
  const current = await fs.readFile(currentPath, "utf8");
  const manifest = current.trim();
  if (!manifest || !await exists(path.join(destination, manifest))) {
    throw new Error(`Pack ${pack.name} points to a missing manifest: ${manifest || "<empty>"}`);
  }
  await fs.writeFile(currentPath, current.replace(/\r\n/g, "\n"), "utf8");

  const db = new ClassicLevel(destination, { keyEncoding: "utf8", valueEncoding: "json", readOnly: true });
  await db.open();
  const documents = [];
  for await (const [, document] of db.iterator()) {
    if (!document || typeof document !== "object") throw new Error(`Pack ${pack.name} contains an invalid document`);
    documents.push(document);
  }
  await db.close();
  validateCuratedItemImages(documents, pack.name);
  if (pack.name === "gear") {
    validateContainerCompendium(documents);
    validateWagonImprovementPack(documents);
  }
  if (pack.name === "magic") validateMagicCompendium(documents);
}

function validateCuratedItemImages(documents, packName) {
  for (const document of documents) inspect(document);

  function inspect(value) {
    if (!value || typeof value !== "object") return;

    const expectedImage = getCuratedItemImage(value);
    if (expectedImage && value.img !== expectedImage) {
      throw new Error(`${packName}: ${value.name} must use curated image ${expectedImage}.`);
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === "object") inspect(child);
    }
  }
}

function validateMagicCompendium(documents) {
  const fireStream = documents.find(document => document.name === "Fire Stream");
  if (!fireStream || fireStream.type !== "spell" || fireStream.system?.defence !== "Dodge or Block") {
    throw new Error("Fire Stream must preserve its rulebook Dodge or Block defence.");
  }

  const supportedDefences = new Set([
    "",
    "Creature's WILL x3",
    "DC set by GM",
    "Dodge",
    "Dodge or Block",
    "None",
    "Reposition",
    "Resist Magic",
    "Resist Magic or Dodge",
    "Spell Casting",
    "Variable",
  ]);
  for (const spell of documents.filter(document => document.type === "spell")) {
    const configured = String(spell.system?.defence ?? "").trim();
    if (!supportedDefences.has(configured)) {
      throw new Error(`${spell.name} uses an unsupported spell defence: ${configured || "<empty>"}.`);
    }
    const effective = getEffectiveSpellDefence(spell);
    const actions = getSpellDefenceActions(effective);
    const shouldHaveRoll = [
      "Dodge",
      "Dodge or Block",
      "Reposition",
      "Resist Magic",
      "Resist Magic or Dodge",
      "Spell Casting",
      "Variable",
    ].includes(configured);
    if (shouldHaveRoll && actions.length === 0) {
      throw new Error(`${spell.name} has no executable defence for ${configured}.`);
    }
    if (configured.includes("Dodge")
      && !effective.includes("only")
      && !actions.includes("Reposition")) {
      throw new Error(`${spell.name} must allow Athletics/Reposition as an alternative to Dodge.`);
    }
  }
}

function validateContainerCompendium(documents) {
  const expected = new Map([
    ["Bandolier", 25],
    ["Basket", 15],
    ["Belt Pouch", 5],
    ["Concealed Chest", 30],
    ["Sack", 20],
    ["Satchel", 30],
    ["Secret Pocket", 5],
    ["Sheath, Bow", null],
    ["Sheath, Garter", null],
    ["Sheath, Sleeve", null],
    ["Wooden Chest", 30],
    ["Wooden Chest, Large", 50],
  ]);
  const containers = documents.filter(document => expected.has(document.name));
  if (containers.length !== expected.size) {
    throw new Error("Gear must contain all configured portable containers.");
  }

  for (const item of containers) {
    const capacity = item.system?.capacity ?? null;
    if (item.type !== "container"
      || capacity !== expected.get(item.name)
      || String(item.system?.quantity) !== "1"
      || !Array.isArray(item.system?.content)) {
      throw new Error(`${item.name} has an invalid container configuration.`);
    }
  }
}

function validateWagonImprovementPack(documents) {
  const expected = new Map([
    ["Deployment Chute", {}],
    ["Front Axle Assembly", { controlBonus: 1 }],
    ["Hidden Compartment", { cargoCapacity: 80 }],
    ["Spiked Wheels", {}],
    ["Steel Wheels", { hpBonus: 20 }],
    ["Studded Wheels", { controlBonus: 1 }],
    ["Camouflage", {}],
    ["Cover Railing", {}],
    ["Steel Top", {}],
    ["Barbed Siding", {}],
    ["Hardened Siding", { spBonus: 10, improvementGroup: "siding-armor" }],
    ["Iron Siding", { spBonus: 20, improvementGroup: "siding-armor" }],
    ["Secure Storage", { cargoCapacity: 80 }],
    ["Sleeping Upgrade", { occupancyBonus: 1 }],
    ["Workshop", {}],
  ]);
  const improvements = documents.filter(document => expected.has(document.name));
  if (improvements.length !== expected.size) {
    throw new Error("Gear must contain all official wagon improvements from Siriol's Handbook.");
  }

  for (const item of improvements) {
    const profile = item.system ?? {};
    const specific = expected.get(item.name);
    if (item.type !== "valuable"
      || profile.type !== "mount-accessories"
      || profile.transportSlot !== "upgrade"
      || Number(profile.improvementCost) !== 1
      || !Array.isArray(profile.transportKinds)
      || profile.transportKinds.join(",") !== "wagon") {
      throw new Error(`${item.name} must be configured as a one-slot wagon improvement.`);
    }
    for (const [field, value] of Object.entries(specific)) {
      if (profile[field] !== value) throw new Error(`${item.name} has an invalid ${field} value.`);
    }
  }
}

async function listFiles(directory, predicate) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath, predicate));
    else if (entry.isFile() && predicate(entry.name)) files.push(fullPath);
  }
  return files;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function isJavaScript(entry) {
  return entry.endsWith(".js") || entry.endsWith(".mjs");
}
