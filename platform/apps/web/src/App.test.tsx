import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the HomeOS shell", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "HomeOS" })).toBeInTheDocument();
  });

  it("enforces RTL Hebrew on the document root", () => {
    render(<App />);
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("he");
    expect(document.documentElement.style.getPropertyValue("--draw-origin")).toBe("right center");
  });
});
