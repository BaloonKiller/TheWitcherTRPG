import { isContainerItem } from "./containerStorage.mjs";

export function getItemDropSource(item, actor) {
  const parent = item?.parent;
  if (parent?.documentName !== "Actor") return "external";
  return parent.uuid === actor?.uuid ? "sameActor" : "otherActor";
}

export function findStackableInventoryItem(items, sourceItem) {
  if (!sourceItem || isContainerItem(sourceItem) || sourceItem.type === "mount") return null;
  return Array.from(items ?? []).find(item =>
    item.name === sourceItem.name
    && item.type === sourceItem.type
    && !item.system?.isStored
  ) ?? null;
}

export function findStackableStoredItem(items, sourceItem) {
  if (!sourceItem || ["container", "diagrams", "mount"].includes(sourceItem.type)) return null;
  return Array.from(items ?? []).find(item =>
    item !== sourceItem
    && (!sourceItem.id || item.id !== sourceItem.id)
    && item.name === sourceItem.name
    && item.type === sourceItem.type
    && item.system?.isStored
  ) ?? null;
}

export function getSingleItemTransfer(quantity) {
  return getItemQuantityTransfer(quantity, 1) ?? { remaining: 0, transferred: 1 };
}

export function getItemQuantityTransfer(quantity, requestedQuantity) {
  const parsedAvailable = Number(quantity);
  const parsedRequested = Number(requestedQuantity);
  if (!Number.isFinite(parsedAvailable) || !Number.isFinite(parsedRequested)) return null;

  const available = Math.floor(parsedAvailable);
  const requested = Math.floor(parsedRequested);
  if (available < 1 || requested < 1) return null;

  const transferred = Math.min(available, requested);
  return {
    remaining: available - transferred,
    transferred,
  };
}
