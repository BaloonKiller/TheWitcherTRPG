export function prepareApplicationTab(app, tabName, hooks = globalThis.Hooks) {
  if (!app || !tabName || typeof app.changeTab !== "function") return false;

  const activate = () => app.changeTab(tabName, "primary", { force: true });

  if (app.rendered) {
    activate();
    return true;
  }

  if (typeof hooks?.on !== "function" || typeof hooks?.off !== "function") return false;

  const hookName = `render${app.constructor.name}`;
  const hookId = hooks.on(hookName, renderedApp => {
    if (renderedApp !== app) return;
    hooks.off(hookName, hookId);
    activate();
  });
  return true;
}
