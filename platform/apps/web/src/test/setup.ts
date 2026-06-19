import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import { server } from "./msw/server";

// Register jest-dom matchers against THIS package's vitest expect. jest-dom declares no vitest dep, so
// its `/vitest` entry's bare `import {expect} from "vitest"` resolves ambiguously once more than one
// vitest version is in the workspace (apps/server + packages/shared still pin vitest@2). Extending the
// expect we import here keeps the matchers on the same instance the tests use.
expect.extend(matchers);

// jsdom has no layout engine — TanStack Router calls window.scrollTo on navigation, which jsdom
// logs as "Not implemented". No-op it so router-driven tests stay quiet.
window.scrollTo = () => {};

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
// globals:false means @testing-library/react's auto-cleanup never registers — unmount explicitly
// so renders don't leak across tests (else getByText finds duplicates).
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
