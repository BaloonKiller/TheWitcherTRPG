export const CURRENCY_TYPES = ["bizant", "ducat", "lintar", "floren", "crown", "oren", "falsecoin"];

const CURRENCY_ITEM_ALIASES = Object.freeze({
  bizant: ["bizant", "bizants", "bizanty"],
  ducat: ["ducat", "ducats", "dukat", "dukaty"],
  lintar: ["lintar", "lintars", "lintary"],
  floren: ["floren", "florens", "floreny"],
  crown: ["crown", "crowns", "korona", "korony"],
  oren: ["oren", "orens", "oreny"],
  falsecoin: ["falsecoin", "falsecoins", "false coin", "false coins", "falszowana moneta", "falszowane monety"],
});

export function getCurrencyItemType(item, options = {}) {
  if (!item) return null;

  const explicitType = item.getFlag?.("thewitchertrpg", "currencyType")
    ?? item.flags?.thewitchertrpg?.currencyType
    ?? item.system?.currencyType;
  if (CURRENCY_TYPES.includes(explicitType)) return explicitType;
  if (item.type !== "valuable") return null;

  const normalizedName = normalizeCurrencyItemName(item.name);
  const localizeCurrency = options.localize;

  for (const currency of CURRENCY_TYPES) {
    const aliases = [...CURRENCY_ITEM_ALIASES[currency]];
    if (localizeCurrency) {
      aliases.push(localizeCurrency(`WITCHER.Currency.${currency}`));
    }
    if (aliases.some(alias => normalizeCurrencyItemName(alias) === normalizedName)) {
      return currency;
    }
  }
  return null;
}

export async function depositCurrencyItem(actor, item, quantity, reason = "", options = {}) {
  const currency = getCurrencyItemType(item, options);
  if (!currency) return null;

  const amount = Number(quantity);
  if (!Number.isInteger(amount) || amount < 1) {
    return { currency, amount: 0, deposited: false };
  }

  if (typeof options.applyChange !== "function") {
    throw new TypeError("Currency item deposits require an applyChange function.");
  }
  const deposited = await options.applyChange(actor, currency, amount, reason);
  return { currency, amount, deposited };
}

export async function migrateLegacyCurrencyItems(actor, reason = "", options = {}) {
  if (!actor?.items) return [];

  const migrated = [];
  for (const item of Array.from(actor.items)) {
    const quantity = Number(item.system?.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) continue;

    const result = await depositCurrencyItem(actor, item, quantity, reason, options);
    if (!result?.deposited) continue;

    await item.delete?.();
    migrated.push({ itemId: item.id ?? item._id, currency: result.currency, amount: result.amount });
  }
  return migrated;
}

function normalizeCurrencyItemName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}
