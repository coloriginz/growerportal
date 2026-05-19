"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  RiArrowLeftLine,
  RiSaveLine,
  RiMailSendLine,
} from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import { toast } from "sonner";

interface CompanyOption {
  id: string;
  name: string;
  slug: string;
}

interface SupplierData {
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
  commercieId: string | null;
  companyId: string | null;
  companyEntity: CompanyOption | null;
  accountManagerCode: string | null;
  accountManagerName: string | null;
  accountManagerUser: { id: string; name: string; email: string } | null;
  preferredLanguage: string;
  seasonStartMonth: number;
  featureSales: boolean;
  featureQuality: boolean;
  featureForecasts: boolean;
  fustEnabled: boolean;
  commercie: { id: string; name: string; email: string } | null;
  growers: {
    id: string;
    code: string | null;
    name: string | null;
    country: string | null;
    city: string | null;
  }[];
  certificates: {
    id: string;
    type: string;
    number: string;
    validFrom: string | null;
    validUntil: string | null;
  }[];
  users: {
    id: string;
    name: string;
    email: string;
    isActive: boolean;
  }[];
}

export function SupplierDetail({ supplierId }: { supplierId: string }) {
  const [supplier, setSupplier] = useState<SupplierData | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [sendingActivation, setSendingActivation] = useState(false);
  const [resendingUserId, setResendingUserId] = useState<string | null>(null);
  const { t } = useLanguage();
  const router = useRouter();

  // Form state
  const [form, setForm] = useState({
    name: "",
    company: "",
    street: "",
    city: "",
    postalCode: "",
    country: "",
    phone: "",
    vatNumber: "",
    ggn: "",
    companyId: "",
    preferredLanguage: "en",
    seasonStartMonth: "1",
    featureSales: true,
    featureQuality: true,
    featureForecasts: true,
    fustEnabled: false,
  });

  useEffect(() => {
    fetchSupplier();
    fetchCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  async function fetchSupplier() {
    try {
      const res = await fetch(`/api/suppliers/${supplierId}`);
      if (res.ok) {
        const data: SupplierData = await res.json();
        setSupplier(data);
        setForm({
          name: data.name || "",
          company: data.company || "",
          street: data.street || "",
          city: data.city || "",
          postalCode: data.postalCode || "",
          country: data.country || "",
          phone: data.phone || "",
          vatNumber: data.vatNumber || "",
          ggn: data.ggn || "",
          companyId: data.companyId || "",
          preferredLanguage: data.preferredLanguage || "en",
          seasonStartMonth: String(data.seasonStartMonth ?? 1),
          featureSales: data.featureSales ?? true,
          featureQuality: data.featureQuality ?? true,
          featureForecasts: data.featureForecasts ?? true,
          fustEnabled: data.fustEnabled ?? false,
        });
      } else {
        router.push("/suppliers");
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchCompanies() {
    const res = await fetch("/api/companies");
    if (res.ok) {
      setCompanies(await res.json());
    } else {
      setCompanies([]);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/suppliers/${supplierId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          company: form.company || null,
          street: form.street || null,
          city: form.city || null,
          postalCode: form.postalCode || null,
          country: form.country || null,
          phone: form.phone || null,
          vatNumber: form.vatNumber || null,
          ggn: form.ggn || null,
          companyId: form.companyId || null,
          preferredLanguage: form.preferredLanguage,
          seasonStartMonth: parseInt(form.seasonStartMonth),
          featureSales: form.featureSales,
          featureQuality: form.featureQuality,
          featureForecasts: form.featureForecasts,
          fustEnabled: form.fustEnabled,
        }),
      });
      if (res.ok) {
        toast.success(t("suppliers.saved"));
        fetchSupplier();
      } else {
        const data = await res.json();
        toast.error(data.error || "Error saving");
      }
    } catch {
      toast.error("Error saving");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddUser() {
    if (!newUserName || !newUserEmail) return;
    setSendingActivation(true);
    try {
      const res = await fetch(`/api/suppliers/${supplierId}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newUserName, email: newUserEmail }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.previewUrl) {
          toast.success(t("suppliers.userAdded"), {
            description: "Ethereal preview available",
            action: {
              label: "Open",
              onClick: () => window.open(data.previewUrl, "_blank"),
            },
            duration: 15000,
          });
        } else {
          toast.success(t("suppliers.userAdded"));
        }
        setNewUserName("");
        setNewUserEmail("");
        fetchSupplier();
      } else {
        const data = await res.json();
        toast.error(data.error || "Error adding user");
      }
    } catch {
      toast.error("Error adding user");
    } finally {
      setSendingActivation(false);
    }
  }

  async function handleResendActivation(user: SupplierData["users"][number]) {
    setResendingUserId(user.id);
    try {
      const res = await fetch(`/api/suppliers/${supplierId}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: user.name, email: user.email, userId: user.id }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.previewUrl) {
          toast.success(t("suppliers.activationSent"), {
            description: "Ethereal preview available",
            action: {
              label: "Open",
              onClick: () => window.open(data.previewUrl, "_blank"),
            },
            duration: 15000,
          });
        } else {
          toast.success(t("suppliers.activationSent"));
        }
        fetchSupplier();
      } else {
        const data = await res.json();
        toast.error(data.error || "Error resending activation");
      }
    } catch {
      toast.error("Error resending activation");
    } finally {
      setResendingUserId(null);
    }
  }

  async function handleDeactivateUser(userId: string) {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    if (res.ok) {
      fetchSupplier();
    }
  }

  if (loading || !supplier) {
    return (
      <div className="page-content">
        <div className="page-header">
          <h1>{t("common.loading")}</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/suppliers")}
          >
            <RiArrowLeftLine className="h-5 w-5" />
          </Button>
          <div>
            <h1>
              {supplier.code} - {supplier.company || supplier.name}
            </h1>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Profile Section */}
        <Card>
          <CardHeader>
            <CardTitle>{t("suppliers.supplierProfile")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("suppliers.code")}</Label>
                <Input value={supplier.code} disabled />
              </div>
              <div className="space-y-2">
                <Label>{t("suppliers.company")}</Label>
                <Input
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("suppliers.street")}</Label>
                <Input
                  value={form.street}
                  onChange={(e) => setForm({ ...form, street: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("suppliers.city")}</Label>
                <Input
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("suppliers.postalCode")}</Label>
                <Input
                  value={form.postalCode}
                  onChange={(e) =>
                    setForm({ ...form, postalCode: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t("suppliers.country")}</Label>
                <Input
                  value={form.country}
                  onChange={(e) =>
                    setForm({ ...form, country: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t("suppliers.phone")}</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("suppliers.vatNumber")}</Label>
                <Input
                  value={form.vatNumber}
                  onChange={(e) =>
                    setForm({ ...form, vatNumber: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t("suppliers.ggn")}</Label>
                <Input
                  value={form.ggn}
                  onChange={(e) => setForm({ ...form, ggn: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Settings Card */}
        <Card>
          <CardHeader>
            <CardTitle>{t("suppliers.settings")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Account Manager */}
            <div>
              <h3 className="text-sm font-semibold mb-3">{t("suppliers.accountManager")}</h3>
              <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("suppliers.amCode")}</Label>
                  <p className="text-sm font-medium tabular-nums">
                    {supplier.accountManagerCode || "-"}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{t("suppliers.amName")}</Label>
                  <p className="text-sm">
                    {supplier.accountManagerName || "-"}
                  </p>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs text-muted-foreground">{t("suppliers.linkedAccount")}</Label>
                  {supplier.accountManagerUser ? (
                    <p className="text-sm">
                      <span className="font-medium">{supplier.accountManagerUser.name}</span>
                      <span className="ml-2 text-muted-foreground">{supplier.accountManagerUser.email}</span>
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("suppliers.noLinkedAccount")}</p>
                  )}
                </div>
              </div>
            </div>

            <Separator />

            {/* Brand / Company */}
            <div>
              <h3 className="text-sm font-semibold mb-3">{t("suppliers.owner")}</h3>
              <div className="max-w-sm space-y-2">
                {companies !== null ? (
                  <Select
                    value={form.companyId || "none"}
                    onValueChange={(v) => {
                      if (v !== null) setForm({ ...form, companyId: v === "none" ? "" : v });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {form.companyId
                          ? companies.find((c) => c.id === form.companyId)?.name
                            ?? supplier.companyEntity?.name
                            ?? form.companyId
                          : t("suppliers.noCompanyAssigned")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("suppliers.noCompanyAssigned")}</SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="bg-muted h-10 animate-pulse rounded-md" />
                )}
                <p className="text-xs text-muted-foreground">
                  {t("suppliers.companyDescription")}
                </p>
              </div>
            </div>

            <Separator />

            {/* Communication Language + Season */}
            <div className="grid gap-6 sm:grid-cols-2 max-w-2xl">
              <div>
                <h3 className="text-sm font-semibold mb-3">{t("common.preferredLanguage")}</h3>
                <div className="space-y-2">
                  <Select
                    value={form.preferredLanguage}
                    onValueChange={(v) => { if (v) setForm({ ...form, preferredLanguage: v }); }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="nl">Nederlands</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t("common.preferredLanguageDescription")}
                  </p>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-3">{t("suppliers.seasonSettings")}</h3>
                <div className="space-y-2">
                  <Select
                    value={form.seasonStartMonth}
                    onValueChange={(v) => { if (v) setForm({ ...form, seasonStartMonth: v }); }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        "January", "February", "March", "April", "May", "June",
                        "July", "August", "September", "October", "November", "December",
                      ].map((name, idx) => (
                        <SelectItem key={idx + 1} value={String(idx + 1)}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t("suppliers.seasonStartMonthDescription")}
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Features */}
            <div>
              <h3 className="text-sm font-semibold mb-3">{t("suppliers.features")}</h3>
              <p className="text-xs text-muted-foreground mb-3">{t("suppliers.featuresDescription")}</p>
              <div className="grid gap-2 sm:grid-cols-2 max-w-md">
                {/* Always-on features (disabled checkboxes) */}
                {([
                  { label: t("suppliers.featureDashboard") },
                  { label: t("suppliers.featureDocuments") },
                ]).map(({ label }) => (
                  <label key={label} className="flex items-center gap-2 opacity-60 cursor-not-allowed">
                    <Checkbox checked={true} disabled />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
                {/* Togglable features */}
                {([
                  { key: "featureSales" as const, label: t("suppliers.featureSales") },
                  { key: "featureQuality" as const, label: t("suppliers.featureQuality") },
                  { key: "featureForecasts" as const, label: t("suppliers.featureForecasts") },
                  { key: "fustEnabled" as const, label: t("suppliers.featureFust") },
                ]).map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={form[key]}
                      onCheckedChange={(checked: boolean) => setForm({ ...form, [key]: checked })}
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            <RiSaveLine className="mr-2 h-4 w-4" />
            {t("common.save")}
          </Button>
        </div>
      </form>

      <Separator />

      {/* Certificates Section */}
      <Card>
        <CardHeader>
          <CardTitle>{t("suppliers.certificates")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("suppliers.certificateType")}</TableHead>
                <TableHead>{t("suppliers.certificateNumber")}</TableHead>
                <TableHead>{t("suppliers.validFrom")}</TableHead>
                <TableHead>{t("suppliers.validUntil")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {supplier.certificates.map((cert) => (
                <TableRow key={cert.id}>
                  <TableCell className="font-medium">{cert.type}</TableCell>
                  <TableCell>{cert.number}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {cert.validFrom
                      ? new Date(cert.validFrom).toLocaleDateString()
                      : "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {cert.validUntil
                      ? new Date(cert.validUntil).toLocaleDateString()
                      : "-"}
                  </TableCell>
                </TableRow>
              ))}
              {supplier.certificates.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={4}
                    className="text-muted-foreground py-8 text-center"
                  >
                    {t("common.noResults")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Growers Section */}
      <Card>
        <CardHeader>
          <CardTitle>Growers ({supplier.growers.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>City</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {supplier.growers.map((grower) => (
                <TableRow key={grower.id}>
                  <TableCell className="font-medium">{grower.code || "-"}</TableCell>
                  <TableCell>{grower.name || "-"}</TableCell>
                  <TableCell className="text-muted-foreground">{grower.country || "-"}</TableCell>
                  <TableCell className="text-muted-foreground">{grower.city || "-"}</TableCell>
                </TableRow>
              ))}
              {supplier.growers.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="text-muted-foreground py-8 text-center">
                    No growers linked to this supplier
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Users Section */}
      <Card>
        <CardHeader>
          <CardTitle>{t("suppliers.users")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {supplier.users.length > 0 ? (
            <div className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("suppliers.userName")}</TableHead>
                    <TableHead>{t("suppliers.email")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{t("common.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supplier.users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell>
                        {user.isActive ? (
                          <Badge variant="default">{t("suppliers.active")}</Badge>
                        ) : (
                          <Badge variant="secondary">{t("suppliers.activationPending")}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {user.isActive ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeactivateUser(user.id)}
                          >
                            {t("suppliers.deactivate")}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleResendActivation(user)}
                            disabled={resendingUserId === user.id}
                          >
                            <RiMailSendLine className="mr-2 h-4 w-4" />
                            {t("suppliers.resendActivation")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("suppliers.noUsers")}
            </p>
          )}

          <Separator />

          <div className="space-y-2">
            <Label className="text-sm font-medium">{t("suppliers.addUser")}</Label>
            <div className="flex max-w-2xl items-end gap-3">
              <div className="flex-1 space-y-2">
                <Label className="text-xs text-muted-foreground">{t("suppliers.userName")}</Label>
                <Input
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="Jan Jansen"
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label className="text-xs text-muted-foreground">{t("suppliers.email")}</Label>
                <Input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="jan@example.com"
                />
              </div>
              <Button
                onClick={handleAddUser}
                disabled={!newUserName || !newUserEmail || sendingActivation}
              >
                <RiMailSendLine className="mr-2 h-4 w-4" />
                {t("suppliers.addUser")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
