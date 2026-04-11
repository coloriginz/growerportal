"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { formatCurrencyDetailed } from "@/lib/format";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  RiCheckLine,
  RiCloseLine,
  RiEditLine,
  RiAddLine,
  RiDeleteBinLine,
} from "@remixicon/react";
import { toast } from "sonner";

interface FustType {
  id: string;
  code: string;
  name: string;
  category: string;
  pricePerUnit: string;
  rentalPricePerUnit: string;
  depositArticleCode: string;
  rentalArticleCode: string;
  isActive: boolean;
  sortOrder: number;
}

interface Transporter {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  preferredLanguage: string;
  isActive: boolean;
}

interface GrowerSetting {
  id: string;
  code: string;
  name: string;
  company: string | null;
  fustEnabled: boolean;
  autoApproveOrders: boolean;
  defaultTransporterId: string | null;
  preferredLanguage: string;
}

interface SettingsData {
  fustTypes: FustType[];
  transporters: Transporter[];
  growers: GrowerSetting[];
}

const CATEGORIES = ["emmers", "karren", "kratten", "dozen", "opzetrekken", "overig"] as const;

export function FustSettings() {
  const { t } = useLanguage();
  const tAny = t as unknown as (key: string) => string;
  const { data, loading, refetch } = useFetch<SettingsData>("/api/fust/settings");
  const [saving, setSaving] = useState(false);

  // Dialog states
  const [growerDialog, setGrowerDialog] = useState<GrowerSetting | null>(null);
  const [transporterDialog, setTransporterDialog] = useState<Transporter | "new" | null>(null);
  const [fustTypeDialog, setFustTypeDialog] = useState<FustType | "new" | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ type: "transporter" | "fustType"; id: string; name: string } | null>(null);

  // Grower edit form state
  const [growerEnabled, setGrowerEnabled] = useState(false);
  const [growerAutoApprove, setGrowerAutoApprove] = useState(false);
  const [growerTransporterId, setGrowerTransporterId] = useState<string | null>(null);
  const [growerLanguage, setGrowerLanguage] = useState("en");

  // Transporter form state
  const [trName, setTrName] = useState("");
  const [trEmail, setTrEmail] = useState("");
  const [trPhone, setTrPhone] = useState("");
  const [trLanguage, setTrLanguage] = useState("en");
  const [trActive, setTrActive] = useState(true);

  // FustType form state
  const [ftCode, setFtCode] = useState("");
  const [ftName, setFtName] = useState("");
  const [ftCategory, setFtCategory] = useState("emmers");
  const [ftPrice, setFtPrice] = useState("");
  const [ftRentalPrice, setFtRentalPrice] = useState("");
  const [ftDepositArticleCode, setFtDepositArticleCode] = useState("2907");
  const [ftRentalArticleCode, setFtRentalArticleCode] = useState("2908");
  const [ftActive, setFtActive] = useState(true);
  const [ftSortOrder, setFtSortOrder] = useState("0");

  const searchParams = useSearchParams();
  const defaultTab = searchParams.get("tab") || "growers";

  const apiCall = async (method: string, body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch("/api/fust/settings", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        return true;
      } else {
        const data = await res.json().catch(() => null);
        const msg = typeof data?.error === "string" ? data.error : "Failed to save";
        toast.error(msg);
        return false;
      }
    } catch {
      toast.error("Failed to save");
      return false;
    } finally {
      setSaving(false);
    }
  };

  // --- Grower dialog handlers ---
  const openGrowerDialog = (grower: GrowerSetting) => {
    setGrowerEnabled(grower.fustEnabled);
    setGrowerAutoApprove(grower.autoApproveOrders);
    setGrowerTransporterId(grower.defaultTransporterId);
    setGrowerLanguage(grower.preferredLanguage || "en");
    setGrowerDialog(grower);
  };

  const saveGrower = async () => {
    if (!growerDialog) return;
    if (growerEnabled && !growerTransporterId) {
      toast.error(t("fust.transporterRequired"));
      return;
    }
    const ok = await apiCall("PATCH", {
      type: "grower",
      growerId: growerDialog.id,
      fustEnabled: growerEnabled,
      autoApproveOrders: growerAutoApprove,
      defaultTransporterId: growerTransporterId,
      preferredLanguage: growerLanguage,
    });
    if (ok) {
      toast.success(t("fust.settingsSaved"));
      setGrowerDialog(null);
      refetch();
    }
  };

  // --- Transporter dialog handlers ---
  const openTransporterDialog = (tr: Transporter | "new") => {
    if (tr === "new") {
      setTrName("");
      setTrEmail("");
      setTrPhone("");
      setTrLanguage("en");
      setTrActive(true);
    } else {
      setTrName(tr.name);
      setTrEmail(tr.email || "");
      setTrPhone(tr.phone || "");
      setTrLanguage(tr.preferredLanguage || "en");
      setTrActive(tr.isActive);
    }
    setTransporterDialog(tr);
  };

  const saveTransporter = async () => {
    if (!trName.trim()) return;
    const body: Record<string, unknown> = {
      type: "transporter",
      name: trName.trim(),
      email: trEmail.trim() || null,
      phone: trPhone.trim() || null,
      preferredLanguage: trLanguage,
      isActive: trActive,
    };
    if (transporterDialog !== "new" && transporterDialog) {
      body.id = transporterDialog.id;
    }
    const ok = await apiCall("PATCH", body);
    if (ok) {
      toast.success(transporterDialog === "new" ? t("fust.created") : t("fust.settingsSaved"));
      setTransporterDialog(null);
      refetch();
    }
  };

  // --- FustType dialog handlers ---
  const openFustTypeDialog = (ft: FustType | "new") => {
    if (ft === "new") {
      setFtCode("");
      setFtName("");
      setFtCategory("emmers");
      setFtPrice("");
      setFtRentalPrice("");
      setFtDepositArticleCode("2907");
      setFtRentalArticleCode("2908");
      setFtActive(true);
      setFtSortOrder("0");
    } else {
      setFtCode(ft.code);
      setFtName(ft.name);
      setFtCategory(ft.category);
      setFtPrice(String(Number(ft.pricePerUnit)));
      setFtRentalPrice(String(Number(ft.rentalPricePerUnit)));
      setFtDepositArticleCode(ft.depositArticleCode);
      setFtRentalArticleCode(ft.rentalArticleCode);
      setFtActive(ft.isActive);
      setFtSortOrder(String(ft.sortOrder));
    }
    setFustTypeDialog(ft);
  };

  const saveFustType = async () => {
    if (!ftCode.trim() || !ftName.trim() || !ftPrice) return;
    const body: Record<string, unknown> = {
      type: "fustType",
      code: ftCode.trim(),
      name: ftName.trim(),
      category: ftCategory,
      pricePerUnit: Number(ftPrice),
      rentalPricePerUnit: Number(ftRentalPrice) || 0,
      depositArticleCode: ftDepositArticleCode.trim() || "2907",
      rentalArticleCode: ftRentalArticleCode.trim() || "2908",
      isActive: ftActive,
      sortOrder: Number(ftSortOrder) || 0,
    };
    if (fustTypeDialog !== "new" && fustTypeDialog) {
      body.id = fustTypeDialog.id;
    }
    const ok = await apiCall("PATCH", body);
    if (ok) {
      toast.success(fustTypeDialog === "new" ? t("fust.created") : t("fust.settingsSaved"));
      setFustTypeDialog(null);
      refetch();
    }
  };

  // --- Delete handler ---
  const confirmDelete = async () => {
    if (!deleteDialog) return;
    const ok = await apiCall("DELETE", { type: deleteDialog.type, id: deleteDialog.id });
    if (ok) {
      toast.success(t("fust.deleted"));
      setDeleteDialog(null);
      refetch();
    }
  };

  if (loading || !data) {
    return <Skeleton className="h-96" />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("fust.settings")}</h1>

      <Tabs defaultValue={defaultTab} key={defaultTab}>
        <TabsList>
          <TabsTrigger value="growers">{t("fust.growerAccess")}</TabsTrigger>
          <TabsTrigger value="types">{t("fust.fustTypes")}</TabsTrigger>
          <TabsTrigger value="transporters">{t("fust.transporters")}</TabsTrigger>
        </TabsList>

        {/* Grower Access */}
        <TabsContent value="growers">
          <div className="mt-4 overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("fust.code")}</TableHead>
                  <TableHead>{t("fust.name")}</TableHead>
                  <TableHead>{t("fust.enabled")}</TableHead>
                  <TableHead>{t("fust.defaultTransporter")}</TableHead>
                  <TableHead>{t("common.preferredLanguage")}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.growers.map((grower) => {
                  const transporter = data.transporters.find(
                    (tr) => tr.id === grower.defaultTransporterId
                  );
                  return (
                    <TableRow
                      key={grower.id}
                      className="cursor-pointer"
                      onClick={() => openGrowerDialog(grower)}
                    >
                      <TableCell className="font-medium">{grower.code}</TableCell>
                      <TableCell>{grower.company || grower.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {grower.fustEnabled ? (
                            <Badge variant="default">{t("fust.enabled")}</Badge>
                          ) : (
                            <Badge variant="outline">{t("fust.disabled")}</Badge>
                          )}
                          {grower.fustEnabled && grower.autoApproveOrders && (
                            <Badge variant="secondary">{t("fust.autoApproved")}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{transporter?.name || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {grower.preferredLanguage === "nl" ? "NL" : "EN"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            openGrowerDialog(grower);
                          }}
                        >
                          <RiEditLine className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Fust Types */}
        <TabsContent value="types">
          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={() => openFustTypeDialog("new")}>
              <RiAddLine className="mr-1.5 h-4 w-4" />
              {t("fust.newFustType")}
            </Button>
          </div>
          <div className="mt-3 overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("fust.code")}</TableHead>
                  <TableHead>{t("fust.name")}</TableHead>
                  <TableHead>{t("fust.category")}</TableHead>
                  <TableHead className="text-right">{t("fust.price")}</TableHead>
                  <TableHead className="text-right">{tAny("fust.rentalPrice")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.fustTypes.map((ft) => (
                  <TableRow
                    key={ft.id}
                    className={`cursor-pointer ${!ft.isActive ? "opacity-50" : ""}`}
                    onClick={() => openFustTypeDialog(ft)}
                  >
                    <TableCell className="font-mono text-sm">{ft.code}</TableCell>
                    <TableCell>{ft.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {t(`fust.${ft.category}` as Parameters<typeof t>[0])}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrencyDetailed(Number(ft.pricePerUnit))}
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(ft.rentalPricePerUnit) > 0
                        ? formatCurrencyDetailed(Number(ft.rentalPricePerUnit))
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {ft.isActive ? (
                        <RiCheckLine className="h-4 w-4 text-green-600" />
                      ) : (
                        <RiCloseLine className="h-4 w-4 text-red-600" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            openFustTypeDialog(ft);
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
                            setDeleteDialog({ type: "fustType", id: ft.id, name: ft.name });
                          }}
                        >
                          <RiDeleteBinLine className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Transporters */}
        <TabsContent value="transporters">
          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={() => openTransporterDialog("new")}>
              <RiAddLine className="mr-1.5 h-4 w-4" />
              {t("fust.newTransporter")}
            </Button>
          </div>
          <div className="mt-3 overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("fust.name")}</TableHead>
                  <TableHead>{t("fust.email")}</TableHead>
                  <TableHead>{t("fust.phone")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.transporters.map((tr) => (
                  <TableRow
                    key={tr.id}
                    className="cursor-pointer"
                    onClick={() => openTransporterDialog(tr)}
                  >
                    <TableCell className="font-medium">{tr.name}</TableCell>
                    <TableCell>{tr.email || "-"}</TableCell>
                    <TableCell>{tr.phone || "-"}</TableCell>
                    <TableCell>
                      {tr.isActive ? (
                        <Badge variant="default">{t("fust.active")}</Badge>
                      ) : (
                        <Badge variant="outline">{t("fust.inactive")}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            openTransporterDialog(tr);
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
                            setDeleteDialog({ type: "transporter", id: tr.id, name: tr.name });
                          }}
                        >
                          <RiDeleteBinLine className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* ---- Grower Edit Dialog ---- */}
      <Dialog open={growerDialog !== null} onOpenChange={(open) => !open && setGrowerDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("fust.editGrower")}</DialogTitle>
            <DialogDescription>
              {growerDialog?.company || growerDialog?.name} ({growerDialog?.code})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t("fust.enabled")}</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={growerEnabled ? "default" : "outline"}
                  size="sm"
                  onClick={() => setGrowerEnabled(true)}
                >
                  {t("fust.enabled")}
                </Button>
                <Button
                  type="button"
                  variant={!growerEnabled ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setGrowerEnabled(false);
                    setGrowerTransporterId(null);
                  }}
                >
                  {t("fust.disabled")}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>
                {t("fust.defaultTransporter")}
                {growerEnabled && <span className="ml-1 text-destructive">*</span>}
              </Label>
              <Select
                key={`tr-${data.transporters.length}`}
                value={growerTransporterId || "none"}
                onValueChange={(v) => setGrowerTransporterId(v === "none" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("fust.noTransporter")}</SelectItem>
                  {data.transporters.map((tr) => (
                    <SelectItem key={tr.id} value={tr.id}>
                      {tr.name}{!tr.isActive ? " (inactive)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {growerEnabled && !growerTransporterId && (
                <p className="text-xs text-destructive">{t("fust.transporterRequired")}</p>
              )}
            </div>
            {growerEnabled && (
              <div className="space-y-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={growerAutoApprove}
                    onChange={(e) => setGrowerAutoApprove(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-primary"
                  />
                  <div>
                    <p className="text-sm font-medium">{t("fust.autoApproveOrders")}</p>
                    <p className="text-xs text-muted-foreground">{t("fust.autoApproveDescription")}</p>
                  </div>
                </label>
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("common.preferredLanguage")}</Label>
              <Select
                value={growerLanguage}
                onValueChange={(v) => v && setGrowerLanguage(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="nl">Nederlands</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrowerDialog(null)}>
              {t("fust.cancel")}
            </Button>
            <Button onClick={saveGrower} disabled={saving}>
              {t("fust.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Transporter Edit/Create Dialog ---- */}
      <Dialog open={transporterDialog !== null} onOpenChange={(open) => !open && setTransporterDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {transporterDialog === "new" ? t("fust.newTransporter") : t("fust.editTransporter")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="tr-name">{t("fust.name")} *</Label>
              <Input
                id="tr-name"
                value={trName}
                onChange={(e) => setTrName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tr-email">{t("fust.email")}</Label>
              <Input
                id="tr-email"
                type="email"
                value={trEmail}
                onChange={(e) => setTrEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tr-phone">{t("fust.phone")}</Label>
              <Input
                id="tr-phone"
                value={trPhone}
                onChange={(e) => setTrPhone(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("common.preferredLanguage")}</Label>
              <Select
                value={trLanguage}
                onValueChange={(v) => v && setTrLanguage(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="nl">Nederlands</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("common.status")}</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={trActive ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTrActive(true)}
                >
                  {t("fust.active")}
                </Button>
                <Button
                  type="button"
                  variant={!trActive ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTrActive(false)}
                >
                  {t("fust.inactive")}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransporterDialog(null)}>
              {t("fust.cancel")}
            </Button>
            <Button onClick={saveTransporter} disabled={saving || !trName.trim()}>
              {transporterDialog === "new" ? t("fust.create") : t("fust.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- FustType Edit/Create Dialog ---- */}
      <Dialog open={fustTypeDialog !== null} onOpenChange={(open) => !open && setFustTypeDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {fustTypeDialog === "new" ? t("fust.newFustType") : t("fust.editFustType")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ft-code">{t("fust.code")} *</Label>
                <Input
                  id="ft-code"
                  value={ftCode}
                  onChange={(e) => setFtCode(e.target.value)}
                  placeholder="Fc555"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ft-sort">{t("fust.sortOrder")}</Label>
                <Input
                  id="ft-sort"
                  type="number"
                  value={ftSortOrder}
                  onChange={(e) => setFtSortOrder(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ft-name">{t("fust.name")} *</Label>
              <Input
                id="ft-name"
                value={ftName}
                onChange={(e) => setFtName(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("fust.category")} *</Label>
                <Select value={ftCategory} onValueChange={(v) => v && setFtCategory(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {t(`fust.${cat}` as Parameters<typeof t>[0])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ft-price">{t("fust.pricePerUnit")} *</Label>
                <Input
                  id="ft-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={ftPrice}
                  onChange={(e) => setFtPrice(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ft-rental-price">{tAny("fust.rentalPrice")}</Label>
                <Input
                  id="ft-rental-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={ftRentalPrice}
                  onChange={(e) => setFtRentalPrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ft-deposit-code">{tAny("fust.depositArticleCode")}</Label>
                <Input
                  id="ft-deposit-code"
                  value={ftDepositArticleCode}
                  onChange={(e) => setFtDepositArticleCode(e.target.value)}
                  placeholder="2907"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ft-rental-code">{tAny("fust.rentalArticleCode")}</Label>
                <Input
                  id="ft-rental-code"
                  value={ftRentalArticleCode}
                  onChange={(e) => setFtRentalArticleCode(e.target.value)}
                  placeholder="2908"
                />
              </div>
              <div />
            </div>
            <div className="space-y-2">
              <Label>{t("common.status")}</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={ftActive ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFtActive(true)}
                >
                  {t("fust.active")}
                </Button>
                <Button
                  type="button"
                  variant={!ftActive ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFtActive(false)}
                >
                  {t("fust.inactive")}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFustTypeDialog(null)}>
              {t("fust.cancel")}
            </Button>
            <Button
              onClick={saveFustType}
              disabled={saving || !ftCode.trim() || !ftName.trim() || !ftPrice}
            >
              {fustTypeDialog === "new" ? t("fust.create") : t("fust.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Delete Confirmation Dialog ---- */}
      <Dialog open={deleteDialog !== null} onOpenChange={(open) => !open && setDeleteDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {deleteDialog?.type === "transporter"
                ? t("fust.deleteTransporter")
                : t("fust.deleteFustType")}
            </DialogTitle>
            <DialogDescription>
              {deleteDialog?.type === "transporter"
                ? t("fust.deleteTransporterConfirm")
                : t("fust.deleteFustTypeConfirm")}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm font-medium">{deleteDialog?.name}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>
              {t("fust.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={saving}>
              {t("fust.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
