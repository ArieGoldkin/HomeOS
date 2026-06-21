import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderBadge } from "./ProviderBadge";

describe("ProviderBadge (#151 provenance)", () => {
  it("renders a quiet label for synced rows (gmail / gcal)", () => {
    const { rerender } = render(<ProviderBadge source="gmail" />);
    expect(screen.getByTestId("provider-badge").textContent).toContain("Gmail");
    rerender(<ProviderBadge source="gcal" />);
    expect(screen.getByTestId("provider-badge").textContent).toContain("יומן");
  });

  it("renders NOTHING for local rows (whatsapp / web) or an undefined source", () => {
    const { container, rerender } = render(<ProviderBadge source="whatsapp" />);
    expect(container.firstChild).toBeNull();
    rerender(<ProviderBadge source="web" />);
    expect(container.firstChild).toBeNull();
    rerender(<ProviderBadge source={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
