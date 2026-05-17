export const TRANSPORT_KINDS = Object.freeze([
  "mount",
  "wagon",
  "landVehicle",
  "waterVehicle",
]);

export const TRANSPORT_CONTROL_SKILLS = Object.freeze(["riding", "sailing"]);

const WAGON_NAMES = new Set([
  "elven gedwch",
  "merchant's wagon",
  "merchant\u2019s wagon",
  "shepherd's hut",
  "shepherd\u2019s hut",
  "war wagon",
]);

const WATER_VEHICLE_PATTERN = /\b(?:boat|cutter|ship|barge|skiff|vessel)\b/i;

export function inferTransportKind(transport) {
  const system = transport?.system ?? transport ?? {};
  if (TRANSPORT_KINDS.includes(system.kind)) return system.kind;

  const name = String(transport?.name ?? system.name ?? "").trim().toLowerCase();
  const legacy = parseLegacyTransportDetails(system.description);
  if (WAGON_NAMES.has(name) || legacy.hasWagonData) return "wagon";
  if (WATER_VEHICLE_PATTERN.test(name)) return "waterVehicle";

  const dexterity = String(system.dex ?? "").trim();
  const speed = String(system.speed ?? "").trim();
  if (/^animal(?:'|\u2019)?s\b/i.test(speed)) return "landVehicle";
  if (dexterity && !/^(?:n\/?a|none|-|\u2014)$/i.test(dexterity)) return "mount";
  if (/\b(?:horse|mule|ox|donkey|pony)\b/i.test(name)) return "mount";
  return "landVehicle";
}

export function getTransportControlSkill(transport) {
  const system = transport?.system ?? transport ?? {};
  if (TRANSPORT_CONTROL_SKILLS.includes(system.controlSkill)) return system.controlSkill;
  return inferTransportKind(transport) === "waterVehicle" ? "sailing" : "riding";
}

export function parseControlModifier(value) {
  const match = String(value ?? "").replace(/\u2212/g, "-").match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

export function parseLegacyTransportDetails(description) {
  const text = stripHtml(description);
  const occupancy = matchNumber(text, /\bOccupancy\s*:\s*(\d+)/i);
  const improvementSlots = matchNumber(text, /\bImprovement\s+Slots?\s*:\s*(\d+)/i);
  const sp = matchNumber(text, /(?:^|\s)SP\s*:\s*(\d+)/im);

  return {
    occupancy,
    improvementSlots,
    sp,
    hasWagonData: occupancy !== null || improvementSlots !== null || sp !== null,
  };
}

/**
 * Normalize only transport fields present in the supplied system source.
 * Foundry invokes data migrations for partial updates, so adding absent
 * storage fields here would detach the pulling animal or clear stored Items.
 */
export function migrateTransportSystemData(source) {
  if (!source || typeof source !== "object") return source;

  const legacy = parseLegacyTransportDetails(source.description);
  if (!source.kind && legacy.hasWagonData) source.kind = "wagon";
  if (!(Number(source.occupancy) > 0) && legacy.occupancy !== null) {
    source.occupancy = legacy.occupancy;
  }
  if (!(Number(source.improvementSlots) > 0) && legacy.improvementSlots !== null) {
    source.improvementSlots = legacy.improvementSlots;
  }
  if (!(Number(source.sp) > 0) && legacy.sp !== null) source.sp = legacy.sp;

  if (Object.hasOwn(source, "pullerId")) source.pullerId ??= "";
  if (Object.hasOwn(source, "accessories")) source.accessories ??= [];
  if (Object.hasOwn(source, "cargo")) source.cargo ??= [];
  return source;
}

export function getTransportAccessoryProfile(accessory) {
  const system = accessory?.system ?? accessory ?? {};
  const name = String(accessory?.name ?? system.name ?? "").trim().toLowerCase();
  const inferred = inferLegacyAccessoryProfile(name);

  return {
    slot: String(system.transportSlot || inferred.slot || "other"),
    controlBonus: preferNonZero(system.controlBonus, inferred.controlBonus),
    speedBonus: preferNonZero(system.speedBonus, inferred.speedBonus),
    spBonus: preferNonZero(system.spBonus, inferred.spBonus),
    hpBonus: preferNonZero(system.hpBonus, inferred.hpBonus),
    occupancyBonus: preferNonZero(system.occupancyBonus, inferred.occupancyBonus),
    cargoCapacity: preferNonZero(system.cargoCapacity, inferred.cargoCapacity),
    improvementCost: Math.max(0, preferNonZero(system.improvementCost, inferred.improvementCost)),
    transportKinds: Array.from(system.transportKinds ?? []).filter(kind => TRANSPORT_KINDS.includes(kind)),
    improvementGroup: String(system.improvementGroup ?? ""),
  };
}

export function getTransportDerivedStats(transport, accessories = [], pullingAnimal = null) {
  const system = transport?.system ?? transport ?? {};
  const kind = inferTransportKind(transport);
  const legacy = parseLegacyTransportDetails(system.description);
  const profiles = accessories.map(getTransportAccessoryProfile);
  const bardingSp = profiles
    .filter(profile => profile.slot === "barding")
    .reduce((maximum, profile) => Math.max(maximum, profile.spBonus), 0);
  const otherSp = sumProfiles(profiles.filter(profile => profile.slot !== "barding"), "spBonus");
  const hpMax = Math.max(0, numeric(system.hp) + sumProfiles(profiles, "hpBonus"));
  const hpValue = normalizeCurrentHp(system.hpCurrent, hpMax);
  const baseCapacity = optionalNumber(system.cargoCapacity);
  const accessoryCapacity = sumProfiles(profiles, "cargoCapacity");
  const improvementSlots = Math.max(0, numeric(system.improvementSlots, legacy.improvementSlots));
  const pullingAnimalSpeed = pullingAnimal?.system?.transportEffectiveSpeed
    ?? pullingAnimal?.system?.transportSpeed
    ?? pullingAnimal?.system?.speed;

  return {
    kind,
    controlSkill: getTransportControlSkill(transport),
    control: parseControlModifier(system.control) + sumProfiles(profiles, "controlBonus"),
    speed: formatEffectiveSpeed(system.speed, sumProfiles(profiles, "speedBonus"), pullingAnimalSpeed),
    hp: { value: hpValue, max: hpMax },
    sp: Math.max(0, numeric(system.sp, legacy.sp) + bardingSp + otherSp),
    occupancy: Math.max(0, numeric(system.occupancy, legacy.occupancy) + sumProfiles(profiles, "occupancyBonus")),
    cargoCapacity: baseCapacity === null && accessoryCapacity === 0
      ? (kind === "mount" ? 0 : null)
      : Math.max(0, (baseCapacity ?? 0) + accessoryCapacity),
    improvementSlots: {
      used: profiles
        .filter(profile => profile.slot === "upgrade")
        .reduce((total, profile) => total + Math.max(1, profile.improvementCost || 0), 0),
      max: improvementSlots,
    },
  };
}

export function usesPullingAnimalSpeed(transport) {
  const system = transport?.system ?? transport ?? {};
  return parsePullingAnimalSpeed(system.speed) !== null;
}

export function buildTransportStorageUpdate(system, collection, contents) {
  const normalizedContents = uniqueStrings(contents);
  return {
    "system.accessories": collection === "accessories"
      ? normalizedContents
      : uniqueStrings(system?.accessories),
    "system.cargo": collection === "cargo"
      ? normalizedContents
      : uniqueStrings(system?.cargo),
  };
}

export function calculateCarriedInventoryWeight(items) {
  const documents = Array.from(items ?? []);
  const itemIndex = indexStoredDocuments(documents);
  const transportContents = new Set();

  for (const transport of documents.filter(item => item?.type === "mount")) {
    for (const reference of [
      ...(transport.system?.accessories ?? []),
      ...(transport.system?.cargo ?? []),
    ]) {
      collectStoredDocumentReferences(resolveStoredDocument(itemIndex, reference), itemIndex, transportContents);
    }
  }

  const weight = documents.reduce((total, item) => {
    if (item?.type === "mount" || hasStoredDocumentReference(transportContents, item)) return total;
    return total + numeric(item?.system?.quantity) * numeric(item?.system?.weight);
  }, 0);
  return Math.ceil(weight);
}

export function calculateItemStackWeight(quantity, unitWeight) {
  const total = Math.max(0, numeric(quantity)) * Math.max(0, numeric(unitWeight));
  return Number(total.toFixed(3));
}

export function calculateStoredItemsWeight(items, ownedItems = items) {
  const roots = Array.from(items ?? []);
  const itemIndex = indexStoredDocuments([...Array.from(ownedItems ?? []), ...roots]);
  const counted = new Set();
  const weight = roots.reduce((total, item) => (
    total + calculateStoredDocumentWeight(item, itemIndex, counted)
  ), 0);
  return Math.ceil(weight);
}

export function getTransportCargoState(transport, accessories = [], cargoItems = [], ownedItems = cargoItems) {
  const items = Array.from(cargoItems ?? []);
  const stats = getTransportDerivedStats(transport, accessories);
  const weight = calculateStoredItemsWeight(items, ownedItems);
  const blocked = items.length > 0 && stats.kind === "mount" && !(stats.cargoCapacity > 0);
  const overloaded = items.length > 0 && (
    blocked
    || (stats.cargoCapacity !== null && weight > stats.cargoCapacity)
  );
  return {
    blocked,
    capacity: stats.cargoCapacity,
    overloaded,
    weight,
  };
}

function calculateStoredDocumentWeight(item, itemIndex, counted) {
  if (!item || hasStoredDocumentReference(counted, item)) return 0;
  addStoredDocumentReference(counted, item);

  let weight = calculateItemStackWeight(item.system?.quantity, item.system?.weight);
  if (item.type !== "container") return weight;

  for (const reference of item.system?.content ?? []) {
    weight += calculateStoredDocumentWeight(resolveStoredDocument(itemIndex, reference), itemIndex, counted);
  }
  return weight;
}

function collectStoredDocumentReferences(item, itemIndex, references) {
  if (!item || hasStoredDocumentReference(references, item)) return;
  addStoredDocumentReference(references, item);
  if (item.type !== "container") return;

  for (const reference of item.system?.content ?? []) {
    collectStoredDocumentReferences(resolveStoredDocument(itemIndex, reference), itemIndex, references);
  }
}

function indexStoredDocuments(items) {
  const index = new Map();
  for (const item of items.filter(Boolean)) {
    if (item.uuid) index.set(item.uuid, item);
    if (item.id) index.set(item.id, item);
  }
  return index;
}

function resolveStoredDocument(index, reference) {
  if (typeof reference !== "string" || reference.length === 0) return null;
  return index.get(reference) ?? index.get(reference.split(".").at(-1)) ?? null;
}

function addStoredDocumentReference(references, item) {
  if (item.uuid) references.add(item.uuid);
  if (item.id) references.add(item.id);
}

function hasStoredDocumentReference(references, item) {
  return Boolean((item?.uuid && references.has(item.uuid)) || (item?.id && references.has(item.id)));
}

export function resolveTransportDamage({ currentHp, maxHp, sp, damage, ignoreSp = false }) {
  const current = normalizeCurrentHp(currentHp, Math.max(0, numeric(maxHp)));
  const incoming = Math.max(0, numeric(damage));
  const armor = ignoreSp ? 0 : Math.max(0, numeric(sp));
  const hpDamage = Math.max(0, incoming - armor);
  const remainingHp = Math.max(0, current - hpDamage);

  return {
    incomingDamage: incoming,
    absorbedDamage: Math.min(incoming, armor),
    hpDamage: current - remainingHp,
    remainingHp,
  };
}

export function getTransportRepairRequirement(currentHp, maxHp) {
  const maximum = Math.max(0, numeric(maxHp));
  const current = normalizeCurrentHp(currentHp, maximum);
  const missing = maximum - current;
  if (missing <= 0) return null;
  return missing <= maximum / 2
    ? { dc: 10, durationKey: "Hour" }
    : { dc: 14, durationKey: "Day" };
}

function inferLegacyAccessoryProfile(name) {
  if (name === "racing saddle") return { slot: "saddle", controlBonus: 1, speedBonus: 1 };
  if (name === "saddle" || name === "cavalry saddle") return { slot: "saddle" };
  if (name === "blinders" || name === "racing blinders") return { slot: "blinders" };
  if (name === "leather barding") return { slot: "barding", spBonus: 10 };
  if (name === "chain barding") return { slot: "barding", spBonus: 15, controlBonus: -1 };
  if (name === "saddlebags") return { slot: "storage", cargoCapacity: 50 };
  if (name === "military saddlebags") return { slot: "storage", cargoCapacity: 100 };
  return {};
}

function formatEffectiveSpeed(speed, bonus, pullingAnimalSpeed = null) {
  const base = String(speed ?? "").trim();
  const pullingAnimalModifier = parsePullingAnimalSpeed(base);
  const numericPullingAnimalSpeed = optionalNumber(pullingAnimalSpeed);
  if (pullingAnimalModifier !== null && numericPullingAnimalSpeed !== null) {
    return String(Math.max(0, numericPullingAnimalSpeed + pullingAnimalModifier + bonus));
  }
  if (!bonus) return base;
  const numericSpeed = Number(base);
  if (base && Number.isFinite(numericSpeed)) return String(numericSpeed + bonus);
  if (!base) return String(bonus);
  return `${base} ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}`;
}

function parsePullingAnimalSpeed(value) {
  const match = String(value ?? "").trim().match(/^animal(?:'|\u2019)?s(?:\s*([+-])\s*(\d+(?:\.\d+)?))?$/i);
  if (!match) return null;
  const amount = Number(match[2] ?? 0);
  return match[1] === "-" ? -amount : amount;
}

function normalizeCurrentHp(value, maximum) {
  if (value === null || value === undefined || value === "") return maximum;
  return Math.min(maximum, Math.max(0, numeric(value)));
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ");
}

function matchNumber(value, pattern) {
  const match = value.match(pattern);
  return match ? Number(match[1]) : null;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function preferNonZero(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number !== 0 ? number : numeric(fallback);
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const fallbackNumber = Number(fallback);
  return Number.isFinite(fallbackNumber) ? fallbackNumber : 0;
}

function sumProfiles(profiles, property) {
  return profiles.reduce((total, profile) => total + numeric(profile[property]), 0);
}

function uniqueStrings(values) {
  return [...new Set(Array.from(values ?? []).filter(value => typeof value === "string" && value))];
}
