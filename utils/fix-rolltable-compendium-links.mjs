import fs from "fs";
import path from "path";
import { ClassicLevel } from "classic-level";

const SYSTEM = JSON.parse(fs.readFileSync("system.json", "utf8"));
const SYSTEM_ID = SYSTEM.id;
const PACK_ROOT = "packs";
const TABLE_RESULT_TYPES = {
  TEXT: 0,
  COMPENDIUM: 2,
};

const DOCUMENT_KEY_PREFIX = {
  Actor: "actors",
  Adventure: "adventures",
  Item: "items",
  JournalEntry: "journal",
  RollTable: "tables",
  Scene: "scenes",
};

const packsByName = new Map(SYSTEM.packs.map(pack => [pack.name, pack]));
const packsByLowerName = new Map(SYSTEM.packs.map(pack => [pack.name.toLowerCase(), pack]));
const packsByLowerLabel = new Map(SYSTEM.packs.map(pack => [pack.label.toLowerCase(), pack]));
const oldCollectionAliases = new Map([
  ["character-gen", "character-generator"],
  ["character-gen sub-tables", "character-generator-sub-tables"],
]);

function normalizeCurrentFile(packDir) {
  const currentPath = path.join(packDir, "CURRENT");
  if (!fs.existsSync(currentPath)) return;

  const current = fs.readFileSync(currentPath, "utf8").trimEnd();
  fs.writeFileSync(currentPath, `${current}\n`, "ascii");
}

async function openPack(packName) {
  const packDir = path.join(PACK_ROOT, packName);
  normalizeCurrentFile(packDir);
  const db = new ClassicLevel(packDir, { valueEncoding: "json" });
  await db.open();
  return db;
}

function normalizeName(name) {
  return String(name ?? "")
    .replace(/&amp;/g, "&")
    .trim()
    .toLowerCase();
}

function getDocumentPack(result) {
  const documentCollection = result.documentCollection ?? result.collection;
  if (!documentCollection) return null;

  const [, packName] = String(documentCollection).split(".");
  if (!packName) return null;

  const normalizedPackName = packName.toLowerCase();
  const alias = oldCollectionAliases.get(normalizedPackName);
  if (alias) return packsByName.get(alias);

  return packsByLowerName.get(normalizedPackName) ?? packsByLowerLabel.get(normalizedPackName) ?? null;
}

async function buildDocumentIndexes() {
  const indexes = new Map();

  for (const pack of SYSTEM.packs) {
    const keyPrefix = DOCUMENT_KEY_PREFIX[pack.type];
    if (!keyPrefix) continue;

    const ids = new Set();
    const names = new Map();
    const db = await openPack(pack.name);

    try {
      for await (const [key, entry] of db.iterator()) {
        if (!key.startsWith(`!${keyPrefix}!`)) continue;
        if (!entry?._id) continue;

        ids.add(entry._id);
        const name = normalizeName(entry.name);
        if (name && !names.has(name)) names.set(name, entry._id);
      }
    } finally {
      await db.close();
    }

    indexes.set(pack.name, { ids, names });
  }

  return indexes;
}

function getLocalCollectionName(packName) {
  return `${SYSTEM_ID}.${packName}`;
}

function resolveTargetPack(result) {
  const collectionPack = getDocumentPack(result);
  if (collectionPack) return collectionPack;

  // Old complete-compendium roll tables used an external module id. Prefer the
  // system pack with the same final collection segment when it now exists here.
  const collection = result.documentCollection ?? result.collection;
  const [, packName] = String(collection ?? "").split(".");
  const normalizedPackName = packName?.toLowerCase();
  const alias = oldCollectionAliases.get(normalizedPackName);
  if (alias) return packsByName.get(alias);

  return packsByLowerName.get(normalizedPackName) ?? packsByLowerLabel.get(normalizedPackName) ?? null;
}

function fixResult(result, indexes) {
  const targetPack = resolveTargetPack(result);
  if (!targetPack) return false;

  const targetIndex = indexes.get(targetPack.name);
  if (!targetIndex) return false;

  const expectedCollection = getLocalCollectionName(targetPack.name);
  const matchingId = targetIndex.names.get(normalizeName(result.text));
  const legacyDocumentId = result.resultId;
  const currentDocumentId = result.documentId ?? legacyDocumentId;
  const currentIdExists = currentDocumentId && targetIndex.ids.has(currentDocumentId);
  let changed = false;

  if (result.documentCollection !== expectedCollection) {
    result.documentCollection = expectedCollection;
    changed = true;
  }

  if (legacyDocumentId && result.documentId !== legacyDocumentId) {
    result.documentId = legacyDocumentId;
    changed = true;
  }

  if (!currentIdExists && matchingId) {
    result.documentId = matchingId;
    changed = true;
  }

  if (!result.documentId || !targetIndex.ids.has(result.documentId)) {
    result.type = TABLE_RESULT_TYPES.TEXT;
    result.documentCollection = null;
    result.documentId = null;
    changed = true;
  } else if (result.type !== TABLE_RESULT_TYPES.COMPENDIUM) {
    result.type = TABLE_RESULT_TYPES.COMPENDIUM;
    changed = true;
  }

  if ("collection" in result) {
    delete result.collection;
    changed = true;
  }

  if ("resultId" in result) {
    delete result.resultId;
    changed = true;
  }

  return changed;
}

function cleanLegacyResultFields(result) {
  let changed = false;

  if (result.type === TABLE_RESULT_TYPES.TEXT && "resultId" in result) {
    delete result.resultId;
    changed = true;
  }

  if (result.type === TABLE_RESULT_TYPES.TEXT && "collection" in result) {
    delete result.collection;
    changed = true;
  }

  return changed;
}

async function fixRollTablePacks() {
  const indexes = await buildDocumentIndexes();
  const updates = [];

  for (const pack of SYSTEM.packs.filter(pack => pack.type === "RollTable")) {
    const db = await openPack(pack.name);
    let packUpdates = 0;

    try {
      for await (const [key, result] of db.iterator()) {
        if (!key.includes("!tables.results!")) continue;

        let changed = cleanLegacyResultFields(result);
        if (result?.documentCollection || result?.collection) {
          changed = fixResult(result, indexes) || changed;
        }

        if (changed) {
          await db.put(key, result);
          packUpdates += 1;
        }
      }
    } finally {
      await db.close();
    }

    if (packUpdates) updates.push(`${pack.name}: ${packUpdates}`);
  }

  console.log(updates.length ? updates.join("\n") : "No roll table links needed changes.");
}

await fixRollTablePacks();
