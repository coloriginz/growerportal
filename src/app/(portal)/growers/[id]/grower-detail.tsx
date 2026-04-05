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
import {
  RiArrowLeftLine,
  RiSaveLine,
  RiMailSendLine,
} from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import { toast } from "sonner";

interface GrowerData {
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
  seasonStartMonth: number;
  commercie: { id: string; name: string; email: string } | null;
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

interface CommercieUser {
  id: string;
  name: string;
  email: string;
}

export function GrowerDetail({ growerId }: { growerId: string }) {
  const [grower, setGrower] = useState<GrowerData | null>(null);
  const [commercieUsers, setCommercieUsers] = useState<CommercieUser[]>([]);
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
    commercieId: "",
    seasonStartMonth: "1",
  });

  useEffect(() => {
    fetchGrower();
    fetchCommercieUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [growerId]);

  async function fetchGrower() {
    try {
      const res = await fetch(`/api/growers/${growerId}`);
      if (res.ok) {
        const data: GrowerData = await res.json();
        setGrower(data);
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
          commercieId: data.commercieId || "",
          seasonStartMonth: String(data.seasonStartMonth ?? 1),
        });
      } else {
        router.push("/growers");
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchCommercieUsers() {
    const res = await fetch("/api/admin/commercie");
    if (res.ok) {
      setCommercieUsers(await res.json());
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/growers/${growerId}`, {
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
          commercieId: form.commercieId || null,
          seasonStartMonth: parseInt(form.seasonStartMonth),
        }),
      });
      if (res.ok) {
        toast.success(t("growers.saved"));
        fetchGrower();
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
      const res = await fetch(`/api/growers/${growerId}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newUserName, email: newUserEmail }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.previewUrl) {
          toast.success(t("growers.userAdded"), {
            description: "Ethereal preview available",
            action: {
              label: "Open",
              onClick: () => window.open(data.previewUrl, "_blank"),
            },
            duration: 15000,
          });
        } else {
          toast.success(t("growers.userAdded"));
        }
        setNewUserName("");
        setNewUserEmail("");
        fetchGrower();
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

  async function handleResendActivation(user: GrowerData["users"][number]) {
    setResendingUserId(user.id);
    try {
      const res = await fetch(`/api/growers/${growerId}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: user.name, email: user.email, userId: user.id }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.previewUrl) {
          toast.success(t("growers.activationSent"), {
            description: "Ethereal preview available",
            action: {
              label: "Open",
              onClick: () => window.open(data.previewUrl, "_blank"),
            },
            duration: 15000,
          });
        } else {
          toast.success(t("growers.activationSent"));
        }
        fetchGrower();
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
      fetchGrower();
    }
  }

  if (loading || !grower) {
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
            onClick={() => router.push("/growers")}
          >
            <RiArrowLeftLine className="h-5 w-5" />
          </Button>
          <div>
            <h1>
              {grower.code} - {grower.name}
            </h1>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Profile Section */}
        <Card>
          <CardHeader>
            <CardTitle>{t("growers.growerProfile")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("growers.code")}</Label>
                <Input value={grower.code} disabled />
              </div>
              <div className="space-y-2">
                <Label>{t("growers.name")}</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>{t("growers.company")}</Label>
                <Input
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("growers.street")}</Label>
                <Input
                  value={form.street}
                  onChange={(e) => setForm({ ...form, street: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("growers.city")}</Label>
                <Input
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("growers.postalCode")}</Label>
                <Input
                  value={form.postalCode}
                  onChange={(e) =>
                    setForm({ ...form, postalCode: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t("growers.country")}</Label>
                <Input
                  value={form.country}
                  onChange={(e) =>
                    setForm({ ...form, country: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t("growers.phone")}</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("growers.vatNumber")}</Label>
                <Input
                  value={form.vatNumber}
                  onChange={(e) =>
                    setForm({ ...form, vatNumber: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t("growers.ggn")}</Label>
                <Input
                  value={form.ggn}
                  onChange={(e) => setForm({ ...form, ggn: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Account Manager Section */}
        <Card>
          <CardHeader>
            <CardTitle>{t("growers.accountManager")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-w-sm space-y-2">
              <Label>{t("growers.accountManager")}</Label>
              {commercieUsers.length > 0 ? (
                <Select
                  value={form.commercieId || "none"}
                  onValueChange={(v) => {
                    if (v !== null) setForm({ ...form, commercieId: v === "none" ? "" : v });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("growers.selectCommercie")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      {t("growers.noCommercieAssigned")}
                    </SelectItem>
                    {commercieUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="bg-muted h-10 animate-pulse rounded-md" />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Season Settings */}
        <Card>
          <CardHeader>
            <CardTitle>{t("growers.seasonSettings")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-w-sm space-y-2">
              <Label>{t("growers.seasonStartMonth")}</Label>
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
                {t("growers.seasonStartMonthDescription")}
              </p>
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
          <CardTitle>{t("growers.certificates")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("growers.certificateType")}</TableHead>
                <TableHead>{t("growers.certificateNumber")}</TableHead>
                <TableHead>{t("growers.validFrom")}</TableHead>
                <TableHead>{t("growers.validUntil")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grower.certificates.map((cert) => (
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
              {grower.certificates.length === 0 && (
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

      {/* Users Section */}
      <Card>
        <CardHeader>
          <CardTitle>{t("growers.users")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {grower.users.length > 0 ? (
            <div className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("growers.userName")}</TableHead>
                    <TableHead>{t("growers.email")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{t("common.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grower.users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell>
                        {user.isActive ? (
                          <Badge variant="default">{t("growers.active")}</Badge>
                        ) : (
                          <Badge variant="secondary">{t("growers.activationPending")}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {user.isActive ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeactivateUser(user.id)}
                          >
                            {t("growers.deactivate")}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleResendActivation(user)}
                            disabled={resendingUserId === user.id}
                          >
                            <RiMailSendLine className="mr-2 h-4 w-4" />
                            {t("growers.resendActivation")}
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
              {t("growers.noUsers")}
            </p>
          )}

          <Separator />

          <div className="space-y-2">
            <Label className="text-sm font-medium">{t("growers.addUser")}</Label>
            <div className="flex max-w-2xl items-end gap-3">
              <div className="flex-1 space-y-2">
                <Label className="text-xs text-muted-foreground">{t("growers.userName")}</Label>
                <Input
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="Jan Jansen"
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label className="text-xs text-muted-foreground">{t("growers.email")}</Label>
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
                {t("growers.addUser")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
