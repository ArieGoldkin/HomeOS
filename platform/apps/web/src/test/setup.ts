import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./msw/server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
// globals:false means @testing-library/react's auto-cleanup never registers — unmount explicitly
// so renders don't leak across tests (else getByText finds duplicates).
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
