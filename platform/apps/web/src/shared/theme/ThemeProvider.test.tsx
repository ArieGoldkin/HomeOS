import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeProvider";

function mockPrefersDark(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  mockPrefersDark(false);
});

afterEach(() => {
  window.localStorage.clear();
});

function Probe() {
  const { theme, setTheme, toggle } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button type="button" onClick={toggle}>
        toggle
      </button>
      <button type="button" onClick={() => setTheme("dark")}>
        go-dark
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
  it("defaults to light when there is no stored choice and the OS does not prefer dark", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("seeds from prefers-color-scheme: dark on first run (no stored choice)", () => {
    mockPrefersDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("an explicit stored choice wins over the OS preference", () => {
    mockPrefersDark(true);
    window.localStorage.setItem("homeos-theme", "light");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
  });

  it("toggle flips the attribute and persists to localStorage", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByText("toggle").click();
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("homeos-theme")).toBe("dark");
    act(() => {
      screen.getByText("toggle").click();
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("homeos-theme")).toBe("light");
  });

  it("useTheme throws when used outside the provider", () => {
    expect(() => renderHook(() => useTheme())).toThrow(/within <ThemeProvider>/);
  });
});
