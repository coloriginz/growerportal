import { Suspense } from "react";
import { LoginContent } from "./login-content";
import { entraEnabled } from "@/lib/auth";

export default function LoginPage() {
  // Server-side flag rather than a NEXT_PUBLIC_ variable: the button should
  // appear exactly when the provider is actually configured, and that is
  // decided by three server-only settings.
  return (
    <Suspense>
      <LoginContent ssoEnabled={entraEnabled} />
    </Suspense>
  );
}
