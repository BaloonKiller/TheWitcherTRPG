import {
  IMAGE_MIGRATION_VERSION,
  normalizeDocumentImagePath,
  normalizeGeneratedImagePath,
} from "./imageMigrations.mjs";

export { normalizeGeneratedImagePath } from "./imageMigrations.mjs";

const SYSTEM_ID = "thewitchertrpg";

export async function migrateGeneratedImagePaths() {
  if (!game.user?.isGM) return 0;

  const currentVersion = Number(game.settings.get(SYSTEM_ID, "systemMigrationVersion")) || 0;
  if (currentVersion >= IMAGE_MIGRATION_VERSION) return 0;

  let updatedReferences = 0;

  for (const actor of game.actors ?? []) {
    updatedReferences += await updateDocument(actor, ["img", "prototypeToken.texture.src"]);
    updatedReferences += await updateEmbeddedDocuments(actor, "Item", actor.items, ["img", "system.associatedItem.img"]);
    updatedReferences += await updateEmbeddedDocuments(actor, "ActiveEffect", actor.effects, ["img", "icon"]);
  }

  updatedReferences += await updateCollection(game.items, ["img", "system.associatedItem.img"]);
  updatedReferences += await updateCollection(game.macros, ["img"]);

  for (const scene of game.scenes ?? []) {
    updatedReferences += await updateDocument(scene, ["background.src", "foreground"]);
    updatedReferences += await updateEmbeddedDocuments(scene, "Token", scene.tokens, ["texture.src"]);
  }

  for (const table of game.tables ?? []) {
    updatedReferences += await updateDocument(table, ["img"]);
    updatedReferences += await updateEmbeddedDocuments(table, "TableResult", table.results, ["img"]);
  }

  for (const journal of game.journal ?? []) {
    updatedReferences += await updateDocument(journal, ["img"]);
    updatedReferences += await updateEmbeddedDocuments(journal, "JournalEntryPage", journal.pages, ["src", "image.src"]);
  }

  await game.settings.set(SYSTEM_ID, "systemMigrationVersion", IMAGE_MIGRATION_VERSION);

  if (updatedReferences > 0) {
    ui.notifications.info(game.i18n.format("WITCHER.Migration.ImagesUpdated", { count: updatedReferences }));
  }
  console.info(`${SYSTEM_ID} | Migrated ${updatedReferences} outdated image references.`);
  return updatedReferences;
}

async function updateCollection(collection, fields) {
  let updatedReferences = 0;
  for (const document of collection ?? []) {
    updatedReferences += await updateDocument(document, fields);
  }
  return updatedReferences;
}

async function updateDocument(document, fields) {
  const { update, count } = buildImageUpdate(document, fields);
  if (count > 0) await document.update(update);
  return count;
}

async function updateEmbeddedDocuments(parent, documentName, collection, fields) {
  const updates = [];
  let updatedReferences = 0;

  for (const document of collection ?? []) {
    const { update, count } = buildImageUpdate(document, fields);
    if (count === 0) continue;
    updates.push({ _id: document.id, ...update });
    updatedReferences += count;
  }

  if (updates.length > 0) {
    await parent.updateEmbeddedDocuments(documentName, updates);
  }
  return updatedReferences;
}

function buildImageUpdate(document, fields) {
  const update = {};
  let count = 0;

  for (const field of fields) {
    const current = getProperty(document, field);
    const normalized = normalizeDocumentImagePath(current, document, field);
    if (normalized === current) continue;
    update[field] = normalized;
    count += 1;
  }

  return { update, count };
}

function getProperty(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}
