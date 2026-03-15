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
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { RiUserLine, RiLockLine, RiEyeLine, RiEyeOffLine } from "@remixicon/react";
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

function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const { t } = useLanguage();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error(t("profile.passwordMismatch"));
      return;
    }
    if (newPassword.length < 8) {
      toast.error(t("profile.passwordTooShort"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/profile/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.ok) {
        toast.success(t("profile.passwordChanged"));
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        const data = await res.json();
        if (res.status === 403) {
          toast.error(t("profile.currentPasswordWrong"));
        } else {
          toast.error(data.error || "Error");
        }
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RiLockLine className="h-5 w-5" />
          {t("profile.changePassword")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t("profile.currentPassword")}</label>
            <div className="relative">
              <Input
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showCurrent ? <RiEyeOffLine className="h-4 w-4" /> : <RiEyeLine className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t("profile.newPassword")}</label>
            <div className="relative">
              <Input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showNew ? <RiEyeOffLine className="h-4 w-4" /> : <RiEyeLine className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t("profile.confirmPassword")}</label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <Button type="submit" disabled={saving || !currentPassword || !newPassword || !confirmPassword}>
            {saving ? t("common.save") + "..." : t("profile.changePassword")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
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
      <div className="page-content">
        <div className="page-header">
          <h1>{t("profile.title")}</h1>
        </div>
        <ChangePasswordSection />
        <div className="empty-state">
          <div className="empty-state-icon">
            <RiUserLine />
          </div>
          <p className="empty-state-text">{t("nav.selectGrower")}</p>
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

      {/* Grower Info */}
      <Card>
        <CardHeader>
          <CardTitle>{t("profile.growerInfo")}</CardTitle>
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

      {/* Change Password */}
      <ChangePasswordSection />

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
