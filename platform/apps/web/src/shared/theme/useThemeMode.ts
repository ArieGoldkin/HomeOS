import { useSyncExternalStore } from "react";
import type { Theme } from "./ThemeProvider";

/**
 * Read the active theme ("light" | "dark") from `<html data-theme>` — the attribute the
 * ThemeProvider (and the index.html boot script) own. Used by presentational leaf atoms
 * (PersonAvatar/PersonChip/EventCard…) to pick light vs dark colors WITHOUT a context
 * dependency, so they render correctly whether or not a ThemeProvider wraps them (e.g. in
 * isolated unit tests, where the attribute is absent → "light"). Reactive: a single shared
 * MutationObserver notifies all consumers when the attribute flips (the theme toggle).
 */
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!observer && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => {
      for (const l of listeners) l();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && observer) {
      observer.disconnect();
      observer = null;
    }
  };
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function useThemeMode(): Theme {
  return useSyncExternalStore(subscribe, getSnapshot, () => "light");
}
