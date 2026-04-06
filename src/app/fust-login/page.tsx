import { Suspense } from "react";
import { FustLoginContent } from "./fust-login-content";

export default function FustLoginPage() {
  return (
    <Suspense>
      <FustLoginContent />
    </Suspense>
  );
}
