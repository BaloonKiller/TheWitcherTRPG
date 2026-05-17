export function flattenDocumentUpdate(updateData, fallbackData = {}) {
  const flattened = {};
  flattenObject(updateData ?? {}, "", flattened);
  for (const [path, value] of Object.entries(fallbackData)) {
    if (!(path in flattened)) flattened[path] = value;
  }
  return flattened;
}

export function buildTransportDocumentUpdate(updateData, transportSystem = {}) {
  return flattenDocumentUpdate(updateData, {
    "system.pullerId": transportSystem.pullerId ?? "",
    "system.accessories": Array.from(transportSystem.accessories ?? []),
    "system.cargo": Array.from(transportSystem.cargo ?? []),
  });
}

export function buildContainerDocumentUpdate(updateData, containerSystem = {}) {
  return flattenDocumentUpdate(updateData, {
    "system.content": Array.from(containerSystem.content ?? []),
  });
}

function flattenObject(value, prefix, flattened) {
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(entry)) {
      flattenObject(entry, path, flattened);
    } else {
      flattened[path] = entry;
    }
  }
}

function isPlainObject(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
