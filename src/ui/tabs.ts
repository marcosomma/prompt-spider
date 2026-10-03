/**
 * A tab strip where at most one panel is visible. Clicking the selected tab
 * again collapses the panel area, so the content above (the prompt) can take
 * the full height when nothing is needed.
 */
export interface Tabs {
  /** Shows a tab's panel; `null` collapses the panel area. */
  select(id: string | null): void;
  selected(): string | null;
  setBadge(id: string, text: string | null, tone?: "warn"): void;
  setVisible(id: string, visible: boolean): void;
  /** Running / error marker on the tab itself. */
  setState(id: string, state: "idle" | "running" | "error"): void;
}

export function createTabs(strip: HTMLElement, panels: HTMLElement): Tabs {
  const tabs = [...strip.querySelectorAll<HTMLButtonElement>(".tab")];
  const panelOf = (id: string): HTMLElement | null => panels.querySelector<HTMLElement>(`[data-panel="${id}"]`);
  let current: string | null = null;

  const apply = (): void => {
    for (const tab of tabs) {
      const id = tab.dataset["tab"] ?? "";
      const on = id === current;
      tab.setAttribute("aria-selected", String(on));
      const panel = panelOf(id);
      if (panel) panel.hidden = !on;
    }
    panels.hidden = current === null;
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const id = tab.dataset["tab"] ?? null;
      current = current === id ? null : id;
      apply();
    });
  }
  apply();

  return {
    select(id) {
      current = id;
      apply();
    },
    selected: () => current,
    setBadge(id, text, tone) {
      const badge = strip.querySelector<HTMLElement>(`[data-badge="${id}"]`);
      if (!badge) return;
      badge.hidden = text === null;
      badge.textContent = text ?? "";
      if (tone) badge.dataset["tone"] = tone;
      else delete badge.dataset["tone"];
    },
    setVisible(id, visible) {
      const tab = tabs.find((t) => t.dataset["tab"] === id);
      if (tab) tab.hidden = !visible;
      if (!visible && current === id) {
        current = null;
        apply();
      }
    },
    setState(id, state) {
      const tab = tabs.find((t) => t.dataset["tab"] === id);
      if (!tab) return;
      if (state === "idle") delete tab.dataset["state"];
      else tab.dataset["state"] = state;
    },
  };
}
