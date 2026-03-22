"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { RiBox3Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/components/providers/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { isTest } from "@/lib/env";

export function FustLoginContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { t } = useLanguage();

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
      router.push("/fust-portal");
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 px-4 dark:from-gray-950 dark:to-gray-900">
      {/* Test Environment Banner */}
      {isTest && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center bg-red-600 px-4 py-1.5 text-xs font-semibold tracking-wide text-white uppercase">
          Test Environment
        </div>
      )}

      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <RiBox3Line className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Fust Portal</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Sign in to manage your crate orders
          </p>
        </div>

        {/* Login Card */}
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="mb-4 flex justify-end">
            <LanguageSwitcher />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fust-email">{t("auth.email")}</Label>
              <Input
                id="fust-email"
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
              <Label htmlFor="fust-password">{t("auth.password")}</Label>
              <Input
                id="fust-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="h-11"
              />
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
            <div className="mt-6 rounded-lg border border-dashed p-3">
              <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wider">
                Demo Accounts
              </p>
              <div className="space-y-1">
                {[
                  { label: "Grower", email: "pcfup@example.com", password: "GreenField99" },
                  { label: "Admin", email: "admin@coloriginz.com", password: "Colori2026!" },
                  { label: "Transporteur", email: "chauffeur@flowertrans.nl", password: "Transport#2026" },
                  { label: "Finance", email: "finance@coloriginz.com", password: "Finance#2026" },
                ].map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    className="text-muted-foreground hover:text-foreground hover:bg-muted flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors"
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
    </div>
  );
}
