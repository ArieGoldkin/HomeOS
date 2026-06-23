import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

/**
 * Light / dark theming (#172). The theme is applied to `<html data-theme>` (the
 * `@custom-variant dark` in globals.css keys off `[data-theme="dark"]`), persisted to
 * localStorage, and seeded from `prefers-color-scheme` on first run. An inline boot
 * script in index.html sets the attribute BEFORE React mounts (anti-FOUC); this provider
 * is the React-side owner and hydrates from the same resolution logic so they agree.
 *
 * Plain context + localStorage on purpose — theme does not warrant a global store yet.
 */
export type Theme = "light" | "dark";

const STORAGE_KEY = "homeos-theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** First-run resolution: an explicit stored choice wins; else the OS preference; else light. */
export function resolveInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage may throw (private mode / disabled) — fall through to OS / default.
  }
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Persistence is best-effort; an unwritable store must not break theming.
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggle = useCallback(
    () => setThemeState((current) => (current === "dark" ? "light" : "dark")),
    [],
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
