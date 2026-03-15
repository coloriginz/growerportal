"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/components/providers/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { isTest } from "@/lib/env";

export default function LoginPage() {
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
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left: Login Form */}
      <div className="flex flex-col justify-center px-8 py-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 flex items-center justify-between">
            <Image
              src="/logo.png"
              alt="Coloriginz"
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
                  { label: "Admin", email: "admin@coloriginz.com", password: "admin123" },
                  { label: "Commercie", email: "ly.dao@coloriginz.com", password: "commercie123" },
                  { label: "Grower", email: "pcfup@example.com", password: "grower123" },
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
  );
}
