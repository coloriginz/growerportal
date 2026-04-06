import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { ActivateForm } from "./activate-form";
import Image from "next/image";
import { getCompanyBranding } from "@/lib/company-config";

interface ActivatePageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ActivatePage({ searchParams }: ActivatePageProps) {
  const { token } = await searchParams;
  const headersList = await headers();
  const companySlug = headersList.get("x-company-slug") || "coloriginz";
  const company = getCompanyBranding(companySlug);

  let valid = false;
  let userName = "";

  if (token) {
    const user = await prisma.user.findUnique({
      where: { activationToken: token },
    });

    if (user) {
      valid = true;
      userName = user.name;
    }
  }

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
          {!token ? (
            <div className="text-center">
              <h1 className="text-xl font-semibold text-gray-900">
                Invalid Link
              </h1>
              <p className="mt-2 text-sm text-gray-500">
                No activation token was provided. Please use the link from your
                activation email.
              </p>
            </div>
          ) : !valid ? (
            <div className="text-center">
              <h1 className="text-xl font-semibold text-gray-900">
                Invalid or Expired Link
              </h1>
              <p className="mt-2 text-sm text-gray-500">
                This activation link is no longer valid. It may have already been
                used or has expired. Please contact your account manager for a
                new link.
              </p>
            </div>
          ) : (
            <ActivateForm token={token} userName={userName} />
          )}
        </div>
      </div>
    </div>
  );
}
