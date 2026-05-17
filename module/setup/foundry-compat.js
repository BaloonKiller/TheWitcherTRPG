const applications = foundry.applications ?? {};
const api = applications.api ?? {};
const sheets = applications.sheets ?? {};
const documents = foundry.documents ?? {};
const documentCollections = documents.collections ?? {};
const ux = applications.ux ?? {};
const utils = foundry.utils ?? {};

export const ActorDocument = documents.Actor ?? globalThis.Actor;
export const ItemDocument = documents.Item ?? globalThis.Item;
export const ChatMessageDocument = documents.ChatMessage ?? globalThis.ChatMessage;
export const FolderDocument = documents.Folder ?? globalThis.Folder;
export const MacroDocument = documents.Macro ?? globalThis.Macro;

const ActorSheetV2 = sheets.ActorSheetV2;
const ItemSheetV2 = sheets.ItemSheetV2;
const DialogV2 = api.DialogV2;
const HandlebarsApplicationMixin = api.HandlebarsApplicationMixin;

export const ActorsCollection = documentCollections.Actors ?? globalThis.Actors;
export const ItemsCollection = documentCollections.Items ?? globalThis.Items;

export const DragDrop = ux.DragDrop ?? globalThis.DragDrop;
export const TextEditor = ux.TextEditor?.implementation ?? ux.TextEditor ?? globalThis.TextEditor;
export const Roll = foundry.dice?.Roll ?? globalThis.Roll;
export const loadTemplates = applications.handlebars?.loadTemplates ?? globalThis.loadTemplates;
export const renderTemplate = applications.handlebars?.renderTemplate ?? globalThis.renderTemplate;

export const mergeObject = utils.mergeObject ?? globalThis.mergeObject;
export const deepClone = utils.deepClone ?? foundry.utils?.duplicate ?? globalThis.duplicate;
export const fromUuid = utils.fromUuid ?? globalThis.fromUuid;
export const fromUuidSync = utils.fromUuidSync ?? globalThis.fromUuidSync;
export const randomID = utils.randomID ?? globalThis.randomID;

const asJQuery = element => (globalThis.jQuery ?? globalThis.$)(element);

const getSheetCssClass = sheet => [
  sheet.isEditable ? "editable" : "locked",
  ...sheet.options.classes,
].filter(Boolean).join(" ");

const WitcherSheetV2Mixin = Base => class extends HandlebarsApplicationMixin(Base) {
  static DEFAULT_OPTIONS = {
    classes: ["witcher", "sheet", "themed", "theme-light"],
    position: {
      width: 520,
      height: 480,
    },
    window: {
      resizable: true,
    },
    form: {
      closeOnSubmit: false,
      submitOnChange: false,
    },
  };

  static PARTS = {
    body: {
      template: "",
      root: true,
      scrollable: [""],
    },
  };

  static TABS = {};

  get object() {
    return this.document;
  }

  get title() {
    return this.document?.name ?? super.title;
  }

  get template() {
    return this.options.template;
  }

  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    parts.body.template = this.template;
    return parts;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, await this.getData(options));
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.classList.toggle("editable", this.isEditable);
    this.element.classList.toggle("locked", !this.isEditable);
    this.element.autocomplete = "off";
    this.activateListeners(asJQuery(this.element));
  }

  async _preClose(options) {
    if (!options.submitted && this.isEditable && this.form?.isConnected) await this.submit();
    await super._preClose(options);
  }

  activateTab(tab, group = "primary") {
    return this.changeTab(tab, group, { force: true });
  }

  activateListeners(_html) {}
};

export class WitcherActorSheetV2 extends WitcherSheetV2Mixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["actor"],
  };

  getData() {
    const actor = this.actor;
    return {
      actor,
      cssClass: getSheetCssClass(this),
      data: actor.toObject(false),
      editable: this.isEditable,
      effects: actor.effects,
      items: Array.from(actor.items),
      limited: actor.limited,
      object: actor,
      owner: actor.isOwner,
      system: actor.system,
      title: this.title,
    };
  }
}

export class WitcherItemSheetV2 extends WitcherSheetV2Mixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["item"],
  };

  getData() {
    const item = this.item;
    return {
      actor: this.actor,
      cssClass: getSheetCssClass(this),
      data: item.system,
      editable: this.isEditable,
      item,
      object: item,
      owner: item.isOwner,
      system: item.system,
      title: this.title,
    };
  }
}

const getDialogIcon = icon => {
  if (!icon) return undefined;
  const match = String(icon).match(/class=["']([^"']+)["']/i);
  return match?.[1] ?? icon;
};

const getTrustedDialogContent = html => {
  const content = document.createElement("div");
  content.innerHTML = String(html ?? "");
  return content;
};

export class WitcherDialog extends DialogV2 {
  constructor(config = {}, options = {}) {
    const buttons = Object.entries(config.buttons ?? {}).map(([action, button]) => ({
      action,
      class: button.class,
      default: action === config.default,
      disabled: button.disabled,
      icon: getDialogIcon(button.icon),
      label: button.label ?? action,
      type: button.type,
      callback: button.callback
        ? (_event, _target, dialog) => button.callback(asJQuery(dialog.element))
        : undefined,
    }));
    const position = Object.fromEntries(
      ["height", "left", "top", "width"]
        .filter(key => options[key] !== undefined)
        .map(key => [key, options[key]]),
    );
    const dialogOptions = {
      buttons,
      content: getTrustedDialogContent(config.content),
      form: {
        closeOnSubmit: config.closeOnSubmit ?? true,
      },
      position,
      window: {
        resizable: options.resizable ?? false,
        title: config.title ?? "",
      },
    };
    super(dialogOptions);

    if (typeof config.close === "function") {
      this.addEventListener("close", () => config.close(asJQuery(this.element)), { once: true });
    }
  }
}

export const sanitizeSheetRenderOptions = (options = {}) => {
  const { token, event, ...safeOptions } = options ?? {};
  return safeOptions;
};

export const registerFoundryCompatibility = () => {
  Math.clamped ??= function (value, min, max) {
    return Math.min(Math.max(value, min), max);
  };
};

export const renderApplication = (app, force = true, options = {}) => {
  if (typeof app?.render !== "function") return Promise.resolve(app);
  return Promise.resolve(app.render({ force, ...sanitizeSheetRenderOptions(options) }));
};

export const renderDocumentSheet = (document, options = {}) => {
  if (!document?.sheet) return null;
  return renderApplication(document.sheet, true, options);
};

export const registerTokenActorSheetDoubleClick = () => {
  const BaseToken = CONFIG.Token?.objectClass;
  if (!BaseToken?.prototype || BaseToken._witcherActorSheetDoubleClickClass) return;

  class WitcherToken extends BaseToken {
    static _witcherActorSheetDoubleClickClass = true;

    async _onClickLeft2(event) {
      const actorId = this.document?.actorId ?? this.document?.actor?.id ?? this.actor?.id;
      const worldActor = game.actors?.get(actorId);
      const actor = this.document?.actor ?? this.actor ?? worldActor ?? this.document?.baseActor;
      if (actor?.sheet) {
        await renderDocumentSheet(actor);
        return;
      }

      return super._onClickLeft2(event);
    }
  }

  CONFIG.Token.objectClass = WitcherToken;
};
