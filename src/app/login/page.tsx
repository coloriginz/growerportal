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
          <div className="mb-8 flex items-center justify-between">
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

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
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
              />
            </div>

            {error && (
              <p className="text-destructive text-sm">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t("common.loading") : t("auth.login")}
            </Button>
          </form>

          {process.env.NODE_ENV === "development" && (
            <div className="mt-8 rounded-lg border border-dashed p-4">
              <p className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wide">
                Demo Accounts
              </p>
              <div className="space-y-2">
                {[
                  { label: "Admin", email: "admin@coloriginz.com", password: "admin123" },
                  { label: "Commercie", email: "ly.dao@coloriginz.com", password: "commercie123" },
                  { label: "Grower", email: "pcfup@example.com", password: "grower123" },
                ].map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    className="text-muted-foreground hover:text-foreground hover:bg-muted flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors"
                    onClick={() => {
                      setEmail(account.email);
                      setPassword(account.password);
                    }}
                  >
                    <span className="font-medium">{account.label}</span>
                    <span>{account.email}</span>
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
      </div>
    </div>
  );
}
