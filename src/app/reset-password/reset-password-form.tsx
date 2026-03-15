"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/components/providers/language-provider";

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const { t } = useLanguage();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [tokenInvalid, setTokenInvalid] = useState(false);

  if (!token) {
    return (
      <div className="text-center">
        <h1 className="text-xl font-semibold text-gray-900">
          {t("auth.invalidResetLink")}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          {t("auth.invalidResetLinkMessage")}
        </p>
        <Link href="/forgot-password">
          <Button variant="outline" className="mt-6 w-full">
            {t("auth.sendResetLink")}
          </Button>
        </Link>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError(t("profile.passwordTooShort"));
      return;
    }

    if (password !== confirmPassword) {
      setError(t("profile.passwordMismatch"));
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (!response.ok) {
        setTokenInvalid(true);
        setLoading(false);
        return;
      }

      setSuccess(true);
    } catch {
      setError(t("activate.genericError"));
      setLoading(false);
    }
  }

  if (tokenInvalid) {
    return (
      <div className="text-center">
        <h1 className="text-xl font-semibold text-gray-900">
          {t("auth.invalidResetLink")}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          {t("auth.invalidResetLinkMessage")}
        </p>
        <Link href="/forgot-password">
          <Button variant="outline" className="mt-6 w-full">
            {t("auth.sendResetLink")}
          </Button>
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <svg
            className="h-6 w-6 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900">
          {t("auth.passwordResetSuccess")}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          {t("auth.passwordResetSuccessMessage")}
        </p>
        <Link href="/login">
          <Button className="mt-6 w-full">
            {t("activate.goToLogin")}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-gray-900">
        {t("auth.resetPasswordTitle")}
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        {t("auth.resetPasswordSubtitle")}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder={t("activate.passwordPlaceholder")}
            className="h-11"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">{t("activate.confirmPassword")}</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder={t("activate.confirmPlaceholder")}
            className="h-11"
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-600">
            {error}
          </div>
        )}

        <Button type="submit" className="h-11 w-full" disabled={loading}>
          {loading ? t("auth.resetting") : t("auth.resetPassword")}
        </Button>
      </form>
    </>
  );
}
