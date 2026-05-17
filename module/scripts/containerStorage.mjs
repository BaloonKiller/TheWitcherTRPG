import { resolveActorOwnedItems } from "./storedItems.mjs";

export const KNOWN_CONTAINER_CAPACITIES = Object.freeze({
  "bandolier": 25,
  "basket": 15,
  "belt pouch": 5,
  "concealed chest": 30,
  "sack": 20,
  "satchel": 30,
  "secret pocket": 5,
  "wooden chest": 30,
  "wooden chest, large": 50,
});

export function normalizeContainerCapacity(value) {
  const capacity = Number(value);
  return Number.isFinite(capacity) && capacity > 0 ? capacity : null;
}

export function getKnownContainerCapacity(item) {
  const explicitCapacity = normalizeContainerCapacity(item?.system?.capacity ?? item?.system?.carry);
  if (explicitCapacity !== null) return explicitCapacity;
  return KNOWN_CONTAINER_CAPACITIES[String(item?.name ?? "").trim().toLowerCase()] ?? null;
}

export function isContainerItem(item) {
  return item?.type === "container" || isLegacyContainerItem(item);
}

export function isLegacyContainerItem(item) {
  return item?.type === "valuable"
    && ["container", "containers"].includes(String(item.system?.type ?? "").toLowerCase());
}

export function prepareContainerItemSource(source) {
  if (!source || !isLegacyContainerItem(source)) return source;

  const { type: _legacyType, ...legacySystem } = source.system ?? {};
  return {
    ...source,
    type: "container",
    system: {
      ...legacySystem,
      quantity: "1",
      capacity: getKnownContainerCapacity(source),
      content: [],
      isStored: false,
    },
  };
}

export async function migrateLegacyContainerItems(actor, replaceSystem = createForcedReplacement) {
  if (typeof actor?.updateEmbeddedDocuments !== "function") return 0;
  const updates = Array.from(actor.items ?? [])
    .map(item => {
      const id = item.id ?? item._id;
      if (!id) return null;
      if (isLegacyContainerItem(item)) {
        const source = prepareContainerItemSource(item.toObject?.() ?? item);
        return {
          _id: id,
          type: source.type,
          system: replaceSystem(source.system),
        };
      }

      const knownCapacity = KNOWN_CONTAINER_CAPACITIES[String(item?.name ?? "").trim().toLowerCase()];
      if (item.type === "container" && item.system?.capacity == null && knownCapacity) {
        return { _id: id, "system.capacity": knownCapacity };
      }
      return null;
    })
    .filter(Boolean);
  if (updates.length === 0) return 0;

  await actor.updateEmbeddedDocuments("Item", updates);
  return updates.length;
}

function createForcedReplacement(value) {
  const ForcedReplacement = globalThis.foundry?.data?.operators?.ForcedReplacement;
  if (typeof ForcedReplacement?.create === "function") {
    return ForcedReplacement.create(value);
  }
  if (typeof globalThis._replace === "function") return globalThis._replace(value);
  // Keeps the pure validation utility usable outside a running Foundry client.
  return value;
}

/**
 * Move an owned container to another Actor without detaching its contents.
 *
 * Embedded Item UUIDs change with their owning Actor, so the container and its
 * children have to be recreated first and the content references rewritten to
 * the newly-created UUIDs before the source documents can be removed.
 */
export async function moveContainerBetweenActors(sourceContainer, targetActor, resolver) {
  const sourceActor = sourceContainer?.parent;
  if (!sourceActor || sourceActor.documentName !== "Actor"
    || !targetActor || sourceActor.uuid === targetActor.uuid
    || typeof targetActor.createEmbeddedDocuments !== "function") {
    return false;
  }

  const sourceContents = resolveActorOwnedItems(
    sourceContainer.system?.content,
    sourceActor,
    resolver,
  ).filter(item => item.uuid !== sourceContainer.uuid);

  let containerSource = prepareContainerItemSource(sourceContainer.toObject?.() ?? sourceContainer);
  containerSource = cloneSource(containerSource);
  delete containerSource._id;
  containerSource.system = {
    ...(containerSource.system ?? {}),
    quantity: "1",
    content: [],
    isStored: false,
  };

  const contentSources = sourceContents.map(item => {
    const source = cloneSource(item.toObject?.() ?? item);
    delete source._id;
    source.system = {
      ...(source.system ?? {}),
      // References are assigned in the same update which marks the children.
      isStored: false,
    };
    if (source.type === "diagrams") source.system.learned = false;
    return source;
  });

  let createdDocuments = [];
  try {
    createdDocuments = await targetActor.createEmbeddedDocuments(
      "Item",
      [containerSource, ...contentSources],
    );
    const [createdContainer, ...createdContents] = createdDocuments;
    if (!createdContainer) throw new Error("The transferred container could not be created.");

    await targetActor.updateEmbeddedDocuments("Item", [
      {
        _id: createdContainer.id,
        "system.content": createdContents.map(item => item.uuid),
      },
      ...createdContents.map(item => ({
        _id: item.id,
        "system.isStored": true,
      })),
    ]);
  } catch (error) {
    const createdIds = createdDocuments.map(item => item.id).filter(Boolean);
    if (createdIds.length > 0 && typeof targetActor.deleteEmbeddedDocuments === "function") {
      await targetActor.deleteEmbeddedDocuments("Item", createdIds).catch(() => {});
    }
    throw error;
  }

  // Delete children first. This prevents the container's pre-delete hook from
  // restoring them to the source inventory while the move is in progress.
  for (const item of sourceContents) await item.delete();
  await sourceContainer.delete();
  return true;
}

export function calculateContainerContentWeight(items) {
  const weight = Array.from(items ?? []).reduce((total, item) => {
    const quantity = normalizeQuantity(item?.system?.quantity, 0);
    const unitWeight = Math.max(0, finiteNumber(item?.system?.weight));
    return total + quantity * unitWeight;
  }, 0);
  return roundWeight(weight);
}

export function getContainerState(container, contentItems = []) {
  const system = container?.system ?? container ?? {};
  const capacity = normalizeContainerCapacity(system.capacity ?? system.carry);
  const weight = calculateContainerContentWeight(contentItems);
  const remaining = capacity === null ? null : roundWeight(Math.max(0, capacity - weight));

  return {
    capacity,
    weight,
    remaining,
    overloaded: capacity !== null && weight > capacity,
    fillPercent: capacity === null ? 0 : Math.min(100, Math.round((weight / capacity) * 100)),
  };
}

export function getContainerTransferLimit(container, contentItems, item) {
  const available = normalizeQuantity(item?.system?.quantity, 0);
  if (available < 1) return 0;

  const state = getContainerState(container, contentItems);
  if (state.capacity === null) return available;

  const unitWeight = Math.max(0, finiteNumber(item?.system?.weight));
  if (unitWeight === 0) return available;

  const remaining = Math.max(0, state.capacity - state.weight);
  return Math.min(available, Math.max(0, Math.floor((remaining + Number.EPSILON) / unitWeight)));
}

export function buildContainerStorageUpdate(contents) {
  return {
    "system.content": uniqueStrings(contents),
  };
}

export function normalizeContainerContents(contents) {
  return uniqueStrings(contents);
}

/**
 * Normalize fields which are actually present in a container system source.
 * Foundry also calls TypeDataModel.migrateData for partial updates. Adding a
 * missing `content` field there would turn an update such as `{isStored: true}`
 * into `{isStored: true, content: []}` and silently empty the container.
 */
export function migrateContainerSystemData(source) {
  if (!source || typeof source !== "object") return source;

  if (Object.hasOwn(source, "carry")) {
    const legacyCapacity = Number(source.carry);
    if (source.capacity == null && Number.isFinite(legacyCapacity) && legacyCapacity > 0) {
      source.capacity = legacyCapacity;
    }
  }
  if (Object.hasOwn(source, "quantity")) source.quantity = "1";
  if (Object.hasOwn(source, "content")) {
    source.content = normalizeContainerContents(source.content);
  }
  return source;
}

function normalizeQuantity(value, fallback) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? Math.floor(quantity) : fallback;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cloneSource(source) {
  if (typeof structuredClone === "function") return structuredClone(source);
  return JSON.parse(JSON.stringify(source));
}

function roundWeight(value) {
  return Number(Math.max(0, value).toFixed(3));
}

function uniqueStrings(values) {
  return [...new Set(Array.from(values ?? []).filter(value => (
    typeof value === "string" && value.length > 0
  )))];
}
