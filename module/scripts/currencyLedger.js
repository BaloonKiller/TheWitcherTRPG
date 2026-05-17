import { WitcherDialog, randomID, renderApplication } from "../setup/foundry-compat.js";
import {
  CURRENCY_TYPES,
  depositCurrencyItem as depositCurrencyItemBase,
  getCurrencyItemType,
  migrateLegacyCurrencyItems as migrateLegacyCurrencyItemsBase,
} from "./currencyItems.mjs";

export { CURRENCY_TYPES, getCurrencyItemType };

const localize = (key) => game.i18n.localize(key);

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const getCurrencyLabel = (currency) => localize(`WITCHER.Currency.${currency}`);

const formatDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const buildCurrencyOptions = (selectedCurrency = "crown") => CURRENCY_TYPES
  .map((currency) => `<option value="${currency}" ${currency === selectedCurrency ? "selected" : ""}>${getCurrencyLabel(currency)}</option>`)
  .join("");

const buildLedgerRows = (actor) => {
  const entries = Array.from(actor.system.currencyLedger ?? []).slice().reverse();
  if (!entries.length) {
    return `<tr><td colspan="6">${localize("WITCHER.CurrencyLedger.NoEntries")}</td></tr>`;
  }

  return entries.map((entry) => {
    const sign = entry.direction === "subtract" ? "-" : "+";
    return `
      <tr>
        <td>${formatDate(entry.createdAt)}</td>
        <td>${getCurrencyLabel(entry.currency)}</td>
        <td>${sign}${Number(entry.amount) || 0}</td>
        <td>${Number(entry.balanceAfter) || 0}</td>
        <td>${escapeHtml(entry.reason)}</td>
        <td>${escapeHtml(entry.userName)}</td>
      </tr>`;
  }).join("");
};

const buildLedgerContent = (actor, selectedCurrency) => `
  <form class="currency-ledger-dialog">
    <div class="currency-ledger-controls">
      <label>${localize("WITCHER.CurrencyLedger.Currency")}</label>
      <select name="currency">${buildCurrencyOptions(selectedCurrency)}</select>
      <label>${localize("WITCHER.CurrencyLedger.Amount")}</label>
      <input name="amount" type="number" min="1" step="1" value="1" />
      <label>${localize("WITCHER.CurrencyLedger.Reason")}</label>
      <input name="reason" type="text" value="" />
    </div>
    <table class="currency-ledger-history">
      <tr>
        <th>${localize("WITCHER.CurrencyLedger.Date")}</th>
        <th>${localize("WITCHER.CurrencyLedger.Currency")}</th>
        <th>${localize("WITCHER.CurrencyLedger.Change")}</th>
        <th>${localize("WITCHER.CurrencyLedger.Balance")}</th>
        <th>${localize("WITCHER.CurrencyLedger.Reason")}</th>
        <th>${localize("WITCHER.CurrencyLedger.User")}</th>
      </tr>
      ${buildLedgerRows(actor)}
    </table>
  </form>`;

export async function applyCurrencyLedgerChange(actor, currency, signedAmount, reason = "") {
  if (!actor || !CURRENCY_TYPES.includes(currency)) {
    return false;
  }

  const amount = Math.abs(Number(signedAmount));
  if (!Number.isInteger(amount) || amount < 1) {
    ui.notifications.error(localize("WITCHER.CurrencyLedger.InvalidAmount"));
    return false;
  }

  const current = Number(actor.system.currency?.[currency]) || 0;
  const direction = Number(signedAmount) < 0 ? "subtract" : "add";
  const balanceAfter = direction === "subtract" ? current - amount : current + amount;
  if (balanceAfter < 0) {
    ui.notifications.error(localize("WITCHER.CurrencyLedger.NotEnoughCurrency"));
    return false;
  }

  const entry = {
    id: randomID?.() ?? foundry.utils.randomID(),
    currency,
    amount,
    direction,
    reason: String(reason ?? "").trim(),
    balanceBefore: current,
    balanceAfter,
    createdAt: new Date().toISOString(),
    userId: game.user?.id ?? "",
    userName: game.user?.name ?? "",
  };

  const ledger = Array.from(actor.system.currencyLedger ?? []);
  ledger.push(entry);
  await actor.update({
    [`system.currency.${currency}`]: balanceAfter,
    "system.currencyLedger": ledger,
  });
  return true;
}

export async function depositCurrencyItem(actor, item, quantity, reason = "", options = {}) {
  return depositCurrencyItemBase(actor, item, quantity, reason, {
    ...options,
    localize: options.localize ?? globalThis.game?.i18n?.localize?.bind(globalThis.game.i18n),
    applyChange: options.applyChange ?? applyCurrencyLedgerChange,
  });
}

export async function migrateLegacyCurrencyItems(actor, reason = "", options = {}) {
  return migrateLegacyCurrencyItemsBase(actor, reason, {
    ...options,
    localize: options.localize ?? globalThis.game?.i18n?.localize?.bind(globalThis.game.i18n),
    applyChange: options.applyChange ?? applyCurrencyLedgerChange,
  });
}

export function registerCurrencyItemMigrationHooks(hooks = globalThis.Hooks) {
  if (!hooks?.once) return;

  hooks.once("ready", () => {
    if (!isPrimaryGameMaster()) return;
    const reason = localize("WITCHER.CurrencyLedger.ConvertedItem");
    Promise.all(Array.from(globalThis.game?.actors ?? [])
      .map(actor => migrateLegacyCurrencyItems(actor, reason)))
      .catch(error => console.error("TheWitcherTRPG | Could not migrate legacy currency items.", error));
  });
}

export async function openCurrencyLedger(actor, selectedCurrency = "crown") {
  if (!actor?.isOwner) {
    ui.notifications.warn(localize("WITCHER.CurrencyLedger.NoPermission"));
    return;
  }

  const submitChange = async (html, multiplier) => {
    const currency = html.find("[name=currency]")[0]?.value;
    const amount = Number(html.find("[name=amount]")[0]?.value);
    const reason = html.find("[name=reason]")[0]?.value;
    const changed = await applyCurrencyLedgerChange(actor, currency, amount * multiplier, reason);
    if (changed) {
      window.setTimeout(() => openCurrencyLedger(actor, currency), 100);
    }
  };

  renderApplication(new WitcherDialog({
    title: `${localize("WITCHER.CurrencyLedger.Title")}: ${escapeHtml(actor.name)}`,
    content: buildLedgerContent(actor, selectedCurrency),
    buttons: {
      add: {
        label: localize("WITCHER.CurrencyLedger.Add"),
        icon: '<i class="fas fa-plus"></i>',
        callback: (html) => submitChange(html, 1),
      },
      subtract: {
        label: localize("WITCHER.CurrencyLedger.Subtract"),
        icon: '<i class="fas fa-minus"></i>',
        callback: (html) => submitChange(html, -1),
      },
      close: {
        label: localize("WITCHER.Button.Cancel"),
      },
    },
  }, {
    width: 720,
    resizable: true,
  }));
}

function isPrimaryGameMaster() {
  const currentUser = globalThis.game?.user;
  if (!currentUser?.isGM) return false;
  const activeGameMaster = globalThis.game?.users?.activeGM;
  return !activeGameMaster || activeGameMaster.id === currentUser.id;
}
