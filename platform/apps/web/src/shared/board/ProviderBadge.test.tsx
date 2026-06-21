import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderBadge } from "./ProviderBadge";

describe("ProviderBadge (#151 provenance)", () => {
  it("renders the exact quiet label for synced rows (gmail / gcal)", () => {
    const { rerender } = render(<ProviderBadge source="gmail" />);
    // F7 — exact label (the <bdi> around "Gmail" is transparent to textContent), so dropping the
    // Hebrew "מ-" prefix would fail; F3 — the Latin run is isolated in a <bdi>.
    const badge = screen.getByTestId("provider-badge");
    expect(badge.textContent).toBe("מ-Gmail");
    expect(badge.querySelector("bdi")?.textContent).toBe("Gmail");
    rerender(<ProviderBadge source="gcal" />);
    expect(screen.getByTestId("provider-badge").textContent).toBe("מהיומן");
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
