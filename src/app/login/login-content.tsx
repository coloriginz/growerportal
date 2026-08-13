"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/components/providers/language-provider";
import { useCompanyBranding } from "@/components/providers/company-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import Link from "next/link";
import { isTest } from "@/lib/env";
import { SsoButton } from "@/components/auth/sso-button";
import { ENTRA_PROVIDER_ID } from "@/lib/entra-sign-in";

/**
 * Codes the signIn callback may hand back. Never render the raw query
 * parameter — check it against this list first.
 */
const SSO_ERROR_KEYS = {
  NoEmailClaim: "auth.ssoNoEmail",
  AccountNotFound: "auth.ssoNoAccount",
  AccountDeactivated: "auth.ssoDeactivated",
  AccountNotAllowed: "auth.ssoNotAllowed",
} as const;

type SsoErrorCode = keyof typeof SSO_ERROR_KEYS;

function isSsoErrorCode(value: string | null): value is SsoErrorCode {
  return value !== null && value in SSO_ERROR_KEYS;
}

export function LoginContent({ ssoEnabled = false }: { ssoEnabled?: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ssoBusy, setSsoBusy] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const { t } = useLanguage();
  const company = useCompanyBranding();

  const ssoErrorParam = searchParams.get("error");
  const ssoError = isSsoErrorCode(ssoErrorParam) ? t(SSO_ERROR_KEYS[ssoErrorParam]) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError(t("auth.invalidCredentials"));
      setLoading(false);
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Test Environment Banner */}
      {isTest && (
        <div className="flex items-center justify-center bg-red-600 px-4 py-1.5 text-xs font-semibold tracking-wide text-white uppercase">
          Test Environment
        </div>
      )}

      <div className="grid flex-1 lg:grid-cols-2">
      {/* Left: Login Form */}
      <div className="flex flex-col justify-center px-8 py-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 flex items-center justify-between">
            <Image
              src={company.logoPath}
              alt={company.name}
              width={180}
              height={48}
              priority
            />
            <LanguageSwitcher />
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">
            {t("auth.loginTitle")}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {t("auth.loginSubtitle")}
          </p>

          {ssoError && (
            <div className="mt-6 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              {ssoError}
            </div>
          )}

          {ssoEnabled && (
            <div className="mt-8 space-y-5">
              <SsoButton
                label={t("auth.ssoLogin")}
                busyLabel={t("common.loading")}
                busy={ssoBusy}
                disabled={loading}
                onClick={() => {
                  setSsoBusy(true);
                  signIn(ENTRA_PROVIDER_ID, { callbackUrl });
                }}
              />
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-muted-foreground text-xs uppercase tracking-wider">
                  {t("auth.ssoDivider")}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("auth.password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="h-11"
              />
            </div>

            <div className="flex justify-end -mt-1">
              <Link
                href="/forgot-password"
                className="text-sm text-muted-foreground hover:text-foreground underline"
              >
                {t("auth.forgotPassword")}
              </Link>
            </div>

            {error && (
              <div className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" className="h-11 w-full" disabled={loading}>
              {loading ? t("common.loading") : t("auth.login")}
            </Button>
          </form>

          {isTest && (
            <div className="mt-10 rounded-lg border border-dashed p-4">
              <p className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wider">
                Demo Accounts
              </p>
              <div className="space-y-1">
                {[
                  { label: "Admin", email: "admin@coloriginz.com", password: "Colori2026!" },
                  { label: "Commercie", email: "iris.inkoper@coloriginz.com", password: "FloraDesk#24" },
                  { label: "Supplier", email: "pcfup@example.com", password: "GreenField99" },
                  { label: "Transporteur", email: "chauffeur@flowertrans.nl", password: "Transport#2026" },
                  { label: "Finance", email: "finance@coloriginz.com", password: "Finance#2026" },
                ].map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    className="text-muted-foreground hover:text-foreground hover:bg-muted flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs transition-colors"
                    onClick={() => {
                      setEmail(account.email);
                      setPassword(account.password);
                    }}
                  >
                    <span className="font-medium">{account.label}</span>
                    <span className="font-mono">{account.email}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Background Image */}
      <div className="relative hidden lg:block">
        <Image
          src="/login-bg.jpg"
          alt="Flower field"
          fill
          className="object-cover"
          priority
        />
        {/* Subtle gradient overlay for depth */}
        <div className="absolute inset-0 bg-gradient-to-r from-background/20 to-transparent" />
      </div>
      </div>
    </div>
  );
}
