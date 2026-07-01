import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/msw/server";
import { useAcceptConsent } from "./use-accept-consent";
import { consentQueryKey, useConsent } from "./use-consent";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}
function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useConsent", () => {
  it("returns the consent status (default handler: consented)", async () => {
    const { result } = renderHook(() => useConsent(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.consented).toBe(true);
  });

  it("reflects consented:false when the user hasn't accepted", async () => {
    server.use(
      http.get("*/consent", () => HttpResponse.json({ consented: false, version: "2026-07-01" })),
    );
    const { result } = renderHook(() => useConsent(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.consented).toBe(false);
  });
});

describe("useAcceptConsent", () => {
  it("records consent and seeds the consent cache (consented:true) so the gate flips", async () => {
    // Start not-consented; after accepting, the seeded cache is consented.
    server.use(
      http.get("*/consent", () => HttpResponse.json({ consented: false, version: "2026-07-01" })),
    );
    const client = makeClient();
    const { result } = renderHook(() => ({ consent: useConsent(), accept: useAcceptConsent() }), {
      wrapper: makeWrapper(client),
    });
    await waitFor(() => expect(result.current.consent.data?.consented).toBe(false));

    result.current.accept.mutate();
    await waitFor(() => expect(result.current.accept.isSuccess).toBe(true));

    // onSuccess seeds consentQueryKey with the consented status.
    expect(client.getQueryData(consentQueryKey)).toMatchObject({ consented: true });
  });
});
