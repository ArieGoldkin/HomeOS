import { signInWithGoogle } from "@shared/auth";
import { Button, Card } from "@shared/ui";
import { useState } from "react";

/**
 * The official multicolor Google "G" mark. Per Google's brand guidance the logo keeps its fixed colors and
 * orientation — so it is NOT rtl-flipped inside the RTL layout (`aria-hidden` + the visible Hebrew label
 * carry the meaning). Colors are hard-coded brand values, never design tokens. (Mirrors the connections
 * feature's GoogleLogo; brand art deliberately kept local to each feature rather than cross-imported.)
 */
function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      role="img"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/**
 * The first-touch login screen (#225) — a standalone, no-shell route (`/login`) that the route guard
 * bounces unauthenticated visitors to. One action: "Sign in with Google", which kicks off the PKCE OAuth
 * round-trip. On success the browser leaves for Google and returns to `/today` with a cookie session, so
 * there is no in-app post-success state to render here; a failure (the promise rejects before navigation)
 * just re-enables the button so the user can retry.
 */
export function LoginScreen() {
  const [submitting, setSubmitting] = useState(false);

  async function handleSignIn() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } catch {
      // The redirect didn't happen — stay on the screen and let the user try again.
      setSubmitting(false);
    }
  }

  return (
    <div className="paper-grain grid min-h-dvh place-items-center p-6">
      <Card className="w-full max-w-sm p-8 text-center shadow-float" data-testid="login-screen">
        <h1 className="font-display font-bold text-[26px] text-[color:var(--ink)]">HomeOS</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">הלוח המשפחתי שלכם</p>

        <Button
          variant="ink"
          className="mt-8 w-full"
          onClick={handleSignIn}
          disabled={submitting}
          data-testid="google-signin"
        >
          <GoogleMark size={18} />
          התחברות עם Google
        </Button>

        <p className="mt-4 text-[12px] text-muted-foreground">
          התחברו עם חשבון ה‑Google של המשפחה.
        </p>
      </Card>
    </div>
  );
}
