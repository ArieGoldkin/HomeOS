import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";

/**
 * App entry: hosts the TanStack Router (landed at #96). The RTL/dir/draw-origin side-effect now lives
 * in the router's RootLayout. QueryClientProvider stays in main.tsx, above this.
 */
export function App() {
  return <RouterProvider router={router} />;
}
