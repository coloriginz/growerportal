"use client";

import { useEffect, useState } from "react";
import { SelectSupplierPrompt } from "@/components/ui/select-supplier-prompt";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RiUserLine } from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";

interface SupplierProfile {
  id: string;
  code: string;
  name: string;
  company: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  phone: string | null;
  vatNumber: string | null;
  ggn: string | null;
  commercie: { name: string; email: string } | null;
  seasonStartMonth?: number;
  certificates: {
    id: string;
    type: string;
    number: string;
    validFrom: string | null;
    validUntil: string | null;
  }[];
}

export function ProfileContent({ supplierId }: { supplierId: string | null }) {
  if (!supplierId) return <SelectSupplierPrompt />;
  const [profile, setProfile] = useState<SupplierProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [changeMessage, setChangeMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    async function fetchProfile() {
      if (!supplierId) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`/api/profile?supplierId=${supplierId}`);
        if (res.ok) {
          setProfile(await res.json());
        }
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, [supplierId]);

  async function handleChangeRequest() {
    if (!changeMessage.trim() || !supplierId) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/change-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId, message: changeMessage }),
      });
      if (res.ok) {
        toast.success(t("profile.changeRequestSent"));
        setChangeMessage("");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!supplierId) {
    return (
      <div className="page-content">
        <div className="page-header">
          <h1>{t("profile.title")}</h1>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">
            <RiUserLine />
          </div>
          <p className="empty-state-text">{t("nav.selectSupplier")}</p>
        </div>
      </div>
    );
  }

  if (loading || !profile) return null;

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>{t("profile.title")}</h1>
      </div>

      {/* Supplier Info */}
      <Card>
        <CardHeader>
          <CardTitle>{t("profile.supplierInfo")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Code</dt>
              <dd className="mt-1 font-medium">{profile.code}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("profile.company")}</dt>
              <dd className="mt-1 font-medium">{profile.company || profile.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("profile.address")}</dt>
              <dd className="mt-1 font-medium">
                {[profile.street, profile.postalCode, profile.city]
                  .filter(Boolean)
                  .join(", ")}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("profile.country")}</dt>
              <dd className="mt-1 font-medium">{profile.country}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("profile.phone")}</dt>
              <dd className="mt-1 font-medium">{profile.phone || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("profile.vatNumber")}</dt>
              <dd className="mt-1 font-medium">{profile.vatNumber || "-"}</dd>
            </div>
            {profile.ggn && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">GGN</dt>
                <dd className="mt-1 font-medium">{profile.ggn}</dd>
              </div>
            )}
          </dl>

          {profile.commercie && (
            <>
              <Separator className="my-6" />
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("profile.commercie")}</dt>
                <dd className="mt-1 font-medium">
                  {profile.commercie.name}{" "}
                  <span className="text-muted-foreground font-normal">({profile.commercie.email})</span>
                </dd>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Season Settings */}
      {profile.seasonStartMonth && (
        <Card>
          <CardHeader>
            <CardTitle>{t("profile.seasonSettings")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("profile.seasonStartMonth")}
              </dt>
              <dd className="mt-1 font-medium">
                {[
                  "January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December",
                ][profile.seasonStartMonth - 1]}
              </dd>
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Certificates */}
      <Card>
        <CardHeader>
          <CardTitle>{t("profile.certificates")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("profile.certificateType")}</TableHead>
                <TableHead>{t("profile.certificateNumber")}</TableHead>
                <TableHead>{t("profile.validUntil")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profile.certificates.map((cert) => (
                <TableRow key={cert.id}>
                  <TableCell>
                    <Badge variant="secondary">{cert.type}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{cert.number}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {cert.validUntil ? formatDate(cert.validUntil) : "-"}
                  </TableCell>
                </TableRow>
              ))}
              {profile.certificates.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="text-muted-foreground text-center py-10">
                    {t("common.noResults")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Change Request */}
      <Card>
        <CardHeader>
          <CardTitle>{t("profile.requestChange")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <textarea
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[120px] w-full rounded-lg border px-4 py-3 text-sm leading-relaxed transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            placeholder={t("profile.changeRequestPlaceholder")}
            value={changeMessage}
            onChange={(e) => setChangeMessage(e.target.value)}
          />
          <Button
            onClick={handleChangeRequest}
            disabled={!changeMessage.trim() || submitting}
          >
            {t("common.submit")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
