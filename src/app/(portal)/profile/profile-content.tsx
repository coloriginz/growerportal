"use client";

import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useLanguage } from "@/components/providers/language-provider";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";

interface GrowerProfile {
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
  certificates: {
    id: string;
    type: string;
    number: string;
    validFrom: string | null;
    validUntil: string | null;
  }[];
}

export function ProfileContent({ growerId }: { growerId: string | null }) {
  const [profile, setProfile] = useState<GrowerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [changeMessage, setChangeMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    async function fetchProfile() {
      if (!growerId) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`/api/profile?growerId=${growerId}`);
        if (res.ok) {
          setProfile(await res.json());
        }
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, [growerId]);

  async function handleChangeRequest() {
    if (!changeMessage.trim() || !growerId) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/change-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ growerId, message: changeMessage }),
      });
      if (res.ok) {
        toast.success(t("profile.changeRequestSent"));
        setChangeMessage("");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!growerId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">{t("profile.title")}</h1>
        <p className="text-muted-foreground">{t("nav.selectGrower")}</p>
      </div>
    );
  }

  if (loading || !profile) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("profile.title")}</h1>

      {/* Grower Info */}
      <Card>
        <CardHeader>
          <CardTitle>{t("profile.growerInfo")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-sm">Code</dt>
              <dd className="font-medium">{profile.code}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">{t("profile.company")}</dt>
              <dd className="font-medium">{profile.company || profile.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">{t("profile.address")}</dt>
              <dd className="font-medium">
                {[profile.street, profile.postalCode, profile.city]
                  .filter(Boolean)
                  .join(", ")}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">{t("profile.country")}</dt>
              <dd className="font-medium">{profile.country}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">{t("profile.phone")}</dt>
              <dd className="font-medium">{profile.phone || "-"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">{t("profile.vatNumber")}</dt>
              <dd className="font-medium">{profile.vatNumber || "-"}</dd>
            </div>
            {profile.ggn && (
              <div>
                <dt className="text-muted-foreground text-sm">GGN</dt>
                <dd className="font-medium">{profile.ggn}</dd>
              </div>
            )}
          </dl>

          {profile.commercie && (
            <>
              <Separator className="my-4" />
              <div>
                <dt className="text-muted-foreground text-sm">{t("profile.commercie")}</dt>
                <dd className="font-medium">
                  {profile.commercie.name} ({profile.commercie.email})
                </dd>
              </div>
            </>
          )}
        </CardContent>
      </Card>

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
                  <TableCell>{cert.number}</TableCell>
                  <TableCell>
                    {cert.validUntil ? formatDate(cert.validUntil) : "-"}
                  </TableCell>
                </TableRow>
              ))}
              {profile.certificates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground text-center py-4">
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
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[100px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
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
