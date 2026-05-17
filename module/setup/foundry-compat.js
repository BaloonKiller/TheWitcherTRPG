const appv1 = foundry.appv1 ?? {};
const documents = foundry.documents ?? {};
const documentCollections = documents.collections ?? {};
const ux = foundry.applications?.ux ?? {};
const utils = foundry.utils ?? {};

export const ActorDocument = documents.Actor ?? globalThis.Actor;
export const ItemDocument = documents.Item ?? globalThis.Item;
export const ChatMessageDocument = documents.ChatMessage ?? globalThis.ChatMessage;
export const FolderDocument = documents.Folder ?? globalThis.Folder;
export const MacroDocument = documents.Macro ?? globalThis.Macro;

export const ActorSheetV1 = appv1.sheets?.ActorSheet ?? globalThis.ActorSheet;
export const ItemSheetV1 = appv1.sheets?.ItemSheet ?? globalThis.ItemSheet;
export const DialogV1 = appv1.api?.Dialog ?? globalThis.Dialog;

export const ActorsCollection = documentCollections.Actors ?? globalThis.Actors;
export const ItemsCollection = documentCollections.Items ?? globalThis.Items;

export const DragDrop = ux.DragDrop ?? globalThis.DragDrop;
export const TextEditor = ux.TextEditor?.implementation ?? ux.TextEditor ?? globalThis.TextEditor;
export const Roll = foundry.dice?.Roll ?? globalThis.Roll;
export const loadTemplates = foundry.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
export const renderTemplate = foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;

export const mergeObject = utils.mergeObject ?? globalThis.mergeObject;
export const deepClone = utils.deepClone ?? foundry.utils?.duplicate ?? globalThis.duplicate;
export const fromUuid = utils.fromUuid ?? globalThis.fromUuid;
export const fromUuidSync = utils.fromUuidSync ?? globalThis.fromUuidSync;
export const randomID = utils.randomID ?? globalThis.randomID;

export const sanitizeSheetRenderOptions = (options = {}) => {
  const { token, event, ...safeOptions } = options ?? {};
  return safeOptions;
};

export const registerFoundryCompatibility = () => {
  Math.clamped ??= function (value, min, max) {
    return Math.min(Math.max(value, min), max);
  };
};

export const renderV1Application = (app, force = true, options = {}) => {
  const safeOptions = sanitizeSheetRenderOptions(options);
  let renderResult;
  if (typeof app?._render === "function") {
    renderResult = app._render(force, safeOptions);
  } else {
    renderResult = app?.render(force, safeOptions);
  }
  return Promise.resolve(renderResult);
};

export const renderDocumentSheet = (document, options = {}) => {
  if (!document?.sheet) {
    return null;
  }
  return renderV1Application(document.sheet, true, { popOut: true, ...options });
};

export const registerTokenActorSheetDoubleClick = () => {
  const TokenClass = CONFIG.Token?.objectClass;
  if (!TokenClass?.prototype || TokenClass.prototype._witcherActorSheetDoubleClickPatched) {
    return;
  }

  const originalOnClickLeft2 = TokenClass.prototype._onClickLeft2;
  TokenClass.prototype._onClickLeft2 = function (event) {
    const actorId = this.document?.actorId ?? this.document?.actor?.id ?? this.actor?.id;
    const worldActor = game.actors?.get(actorId);
    const actor = worldActor ?? this.document?.baseActor ?? this.actor;
    if (actor?.sheet) {
      renderDocumentSheet(actor).catch((error) => {
        console.error("TheWitcherTRPG | Failed to render token actor sheet", error);
      });
      return;
    }

    return originalOnClickLeft2?.call(this, event);
  };

  TokenClass.prototype._witcherActorSheetDoubleClickPatched = true;
};
