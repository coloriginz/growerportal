"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/components/providers/language-provider";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { t } = useLanguage();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch("/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (data.previewUrl) {
        setPreviewUrl(data.previewUrl);
      }

      setSent(true);
    } catch {
      // Still show success to not leak information
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Image
            src="/logo.png"
            alt="Coloriginz"
            width={180}
            height={48}
            priority
          />
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          {sent ? (
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
                    d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
                  />
                </svg>
              </div>
              <h1 className="text-xl font-semibold text-gray-900">
                {t("auth.forgotPasswordTitle")}
              </h1>
              <p className="mt-2 text-sm text-gray-500">
                {t("auth.resetLinkSent")}
              </p>

              {previewUrl && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-block text-sm text-blue-600 underline hover:text-blue-800"
                >
                  View email in Ethereal
                </a>
              )}

              <Link href="/login">
                <Button variant="outline" className="mt-6 w-full">
                  {t("auth.backToLogin")}
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-gray-900">
                {t("auth.forgotPasswordTitle")}
              </h1>
              <p className="mt-2 text-sm text-gray-500">
                {t("auth.forgotPasswordSubtitle")}
              </p>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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

                <Button type="submit" className="h-11 w-full" disabled={loading}>
                  {loading ? t("auth.sending") : t("auth.sendResetLink")}
                </Button>
              </form>

              <div className="mt-4 text-center">
                <Link
                  href="/login"
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                >
                  {t("auth.backToLogin")}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
