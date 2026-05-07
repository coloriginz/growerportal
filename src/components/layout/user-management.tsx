"use client";

import { useState } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  RiAddLine,
  RiEditLine,
  RiDeleteBinLine,
} from "@remixicon/react";
import { toast } from "sonner";
import type { Role } from "@/types";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  transporterId: string | null;
  transporterName: string | null;
}

interface Transporter {
  id: string;
  name: string;
  isActive: boolean;
}

interface UserManagementProps {
  /** Which roles can be assigned to users in this context */
  allowedRoles: Role[];
  /** Transporters list for linking transporteur users (fetched externally or passed in) */
  transporters?: Transporter[];
  /** Title override */
  title?: string;
}

const ROLE_LABELS: Record<Role, string> = {
  supplier: "Supplier",
  commercie: "Commercie",
  admin: "Admin",
  transporteur: "Transporteur",
  finance: "Finance",
};

export function UserManagement({ allowedRoles, transporters: externalTransporters, title }: UserManagementProps) {
  const { t } = useLanguage();
  const rolesParam = allowedRoles.join(",");
  const { data: users, loading, refetch } = useFetch<UserRow[]>(
    `/api/admin/users?roles=${rolesParam}`
  );

  // Fetch transporters if transporteur is an allowed role and none provided externally
  const needTransporters = allowedRoles.includes("transporteur") && !externalTransporters;
  const { data: fetchedTransporters } = useFetch<{ transporters: Transporter[] }>(
    needTransporters ? "/api/fust/settings" : null
  );
  const transporters = externalTransporters ?? fetchedTransporters?.transporters ?? [];

  const [saving, setSaving] = useState(false);
  const [editDialog, setEditDialog] = useState<UserRow | "new" | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<UserRow | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formRole, setFormRole] = useState<string>(allowedRoles[0]);
  const [formTransporterId, setFormTransporterId] = useState<string | null>(null);

  const openDialog = (user: UserRow | "new") => {
    if (user === "new") {
      setFormName("");
      setFormEmail("");
      setFormRole(allowedRoles[0]);
      setFormTransporterId(null);
    } else {
      setFormName(user.name);
      setFormEmail(user.email);
      setFormRole(user.role);
      setFormTransporterId(user.transporterId);
    }
    setEditDialog(user);
  };

  const saveUser = async () => {
    if (!formName.trim() || !formEmail.trim()) return;
    if (formRole === "transporteur" && !formTransporterId) {
      toast.error(t("admin.transporterRequired" as Parameters<typeof t>[0]));
      return;
    }

    setSaving(true);
    try {
      const isNew = editDialog === "new";
      const url = isNew
        ? "/api/admin/users"
        : `/api/admin/users/${(editDialog as UserRow).id}`;
      const method = isNew ? "POST" : "PATCH";

      const body: Record<string, unknown> = {
        name: formName.trim(),
        email: formEmail.trim(),
        role: formRole,
      };
      if (formRole === "transporteur") {
        body.transporterId = formTransporterId;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast.success(
          isNew ? t("admin.activationLinkSent") : t("fust.settingsSaved")
        );
        setEditDialog(null);
        refetch();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(typeof data?.error === "string" ? data.error : "Error saving user");
      }
    } catch {
      toast.error("Error saving user");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (user: UserRow) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      if (res.ok) refetch();
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async () => {
    if (!deleteDialog) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteDialog.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success(t("fust.deleted"));
        setDeleteDialog(null);
        refetch();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(typeof data?.error === "string" ? data.error : "Error deleting user");
      }
    } catch {
      toast.error("Error deleting user");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !users) {
    return <Skeleton className="h-96" />;
  }

  const showTransporter = allowedRoles.includes("transporteur");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {title ?? t("admin.title")}
        </h1>
        <Button size="sm" onClick={() => openDialog("new")}>
          <RiAddLine className="mr-1.5 h-4 w-4" />
          {t("admin.createUser")}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fust.name")}</TableHead>
              <TableHead>{t("fust.email")}</TableHead>
              <TableHead>{t("admin.role")}</TableHead>
              {showTransporter && <TableHead>{t("fust.transporter")}</TableHead>}
              <TableHead>{t("common.status")}</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow
                key={user.id}
                className="cursor-pointer"
                onClick={() => openDialog(user)}
              >
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell className="text-muted-foreground">{user.email}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{ROLE_LABELS[user.role as Role] ?? user.role}</Badge>
                </TableCell>
                {showTransporter && (
                  <TableCell>{user.transporterName || "-"}</TableCell>
                )}
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    disabled={saving}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleActive(user);
                    }}
                  >
                    {user.isActive ? (
                      <Badge variant="default">{t("admin.active")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("admin.inactive")}</Badge>
                    )}
                  </Button>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDialog(user);
                      }}
                    >
                      <RiEditLine className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteDialog(user);
                      }}
                    >
                      <RiDeleteBinLine className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={showTransporter ? 6 : 5} className="text-center text-muted-foreground py-8">
                  No users found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ---- Create/Edit Dialog ---- */}
      <Dialog open={editDialog !== null} onOpenChange={(open) => !open && setEditDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editDialog === "new" ? t("admin.createUser") : `${formName}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="user-name">{t("fust.name")} *</Label>
              <Input
                id="user-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-email">{t("fust.email")} *</Label>
              <Input
                id="user-email"
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t("admin.role")} *</Label>
              <Select value={formRole} onValueChange={(v) => v && setFormRole(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedRoles.map((role) => (
                    <SelectItem key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {formRole === "transporteur" && (
              <div className="space-y-2">
                <Label>
                  {t("fust.transporter")} <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={formTransporterId || "none"}
                  onValueChange={(v) => v && setFormTransporterId(v === "none" ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-</SelectItem>
                    {transporters
                      .filter((tr) => tr.isActive)
                      .map((tr) => (
                        <SelectItem key={tr.id} value={tr.id}>
                          {tr.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(null)}>
              {t("fust.cancel")}
            </Button>
            <Button
              onClick={saveUser}
              disabled={saving || !formName.trim() || !formEmail.trim()}
            >
              {editDialog === "new" ? t("fust.create") : t("fust.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Delete Confirmation Dialog ---- */}
      <Dialog open={deleteDialog !== null} onOpenChange={(open) => !open && setDeleteDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("fust.delete")}</DialogTitle>
            <DialogDescription>
              {t("fust.deleteConfirm")}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm font-medium">
            {deleteDialog?.name} ({deleteDialog?.email})
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>
              {t("fust.cancel")}
            </Button>
            <Button variant="destructive" onClick={deleteUser} disabled={saving}>
              {t("fust.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
