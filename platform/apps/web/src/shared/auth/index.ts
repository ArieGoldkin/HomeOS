// Group barrel for shared/auth — Supabase session STATE + the Google sign-in action (#225).
// Public API only; consumers import from "@shared/auth". The raw client stays internal to the group.
export {
  AuthProvider,
  type AuthState,
  type AuthStatus,
  type CurrentUser,
  useCurrentUser,
} from "./AuthProvider";
export { signInWithGoogle } from "./sign-in";
export { updateDisplayName } from "./update-profile";
