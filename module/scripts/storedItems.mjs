export function findOrphanedStoredItems(items) {
  const documents = Array.from(items ?? []);
  const referencedItems = collectStoredItemReferences(documents);

  return documents.filter(document => document.system?.isStored
    && !isReferenced(referencedItems, document));
}

export function findUnmarkedStoredItems(items) {
  const documents = Array.from(items ?? []);
  const referencedItems = collectStoredItemReferences(documents);
  return documents.filter(document => !document.system?.isStored
    && isReferenced(referencedItems, document));
}

function collectStoredItemReferences(documents) {
  const referencedItems = new Set();

  for (const document of documents) {
    const references = document.type === "container"
      ? document.system?.content
      : document.type === "mount"
        ? [...(document.system?.accessories ?? []), ...(document.system?.cargo ?? [])]
        : [];
    for (const reference of references ?? []) addReference(referencedItems, reference);
  }
  return referencedItems;
}

export function resolveActorOwnedItems(references, actor, resolver) {
  if (typeof resolver !== "function") return [];
  return Array.from(references ?? [])
    .map(reference => {
      if (typeof reference !== "string") return null;
      let resolved = null;
      try {
        resolved = resolver(reference);
      } catch (_error) {
        // Legacy storage used bare embedded Item IDs, which are not valid UUIDs.
      }
      if (resolved) return resolved;
      const id = reference.split(".").at(-1);
      return actor?.items?.get?.(id)
        ?? Array.from(actor?.items ?? []).find(document => document?.id === id)
        ?? null;
    })
    .filter(document => document && (!actor || document.parent?.uuid === actor.uuid));
}

function addReference(referencedItems, reference) {
  if (typeof reference !== "string" || reference.length === 0) return;
  referencedItems.add(reference);
  referencedItems.add(reference.split(".").at(-1));
}

function isReferenced(referencedItems, document) {
  return referencedItems.has(document.uuid) || referencedItems.has(document.id);
}
