import { Suspense } from "react";
import { headers } from "next/headers";
import Image from "next/image";
import { getCompanyBranding } from "@/lib/company-config";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage() {
  const headersList = await headers();
  const companySlug = headersList.get("x-company-slug") || "coloriginz";
  const company = getCompanyBranding(companySlug);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Image
            src={company.logoPath}
            alt={company.name}
            width={180}
            height={48}
            priority
          />
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <Suspense fallback={<div className="text-center text-sm text-gray-500">Loading...</div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
