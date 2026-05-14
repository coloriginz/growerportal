"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RiAddLine, RiSearchLine, RiPlantLine } from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import { toast } from "sonner";
import { FabricRelationsTab } from "./fabric-relations-tab";

interface CompanyOption {
  id: string;
  name: string;
  slug: string;
}

interface SupplierRow {
  id: string;
  code: string;
  name: string;
  company: string | null;
  country: string | null;
  companyEntity: { id: string; name: string; slug: string } | null;
  commercie: { id: string; name: string } | null;
  loginStatus: "active" | "pending" | "none";
  userCount: number;
  growerCount: number;
}

export function SuppliersContent({ isAdmin }: { isAdmin?: boolean }) {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const { t } = useLanguage();
  const router = useRouter();

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    company: "",
    country: "",
    companyId: "",
  });

  useEffect(() => {
    fetchSuppliers();
    fetchCompanies();
  }, []);

  async function fetchCompanies() {
    try {
      const res = await fetch("/api/companies");
      if (res.ok) setCompanies(await res.json());
    } catch { /* ignore */ }
  }

  async function fetchSuppliers() {
    try {
      const res = await fetch("/api/suppliers?full=1");
      if (res.ok) {
        setSuppliers(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateSupplier(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          companyId: formData.companyId || undefined,
        }),
      });
      if (res.ok) {
        toast.success(t("suppliers.created"));
        setDialogOpen(false);
        setFormData({ code: "", name: "", company: "", country: "", companyId: "" });
        fetchSuppliers();
      } else {
        const data = await res.json();
        toast.error(data.error || "Error creating supplier");
      }
    } catch {
      toast.error("Error creating supplier");
    }
  }

  const filtered = suppliers.filter((g) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      g.code.toLowerCase().includes(q) ||
      g.name.toLowerCase().includes(q) ||
      (g.company && g.company.toLowerCase().includes(q)) ||
      (g.companyEntity && g.companyEntity.name.toLowerCase().includes(q))
    );
  });

  function statusBadge(supplier: SupplierRow) {
    const countSuffix = supplier.userCount > 1 ? ` (${supplier.userCount})` : "";
    switch (supplier.loginStatus) {
      case "active":
        return <Badge variant="default">{t("suppliers.active")}{countSuffix}</Badge>;
      case "pending":
        return <Badge variant="secondary">{t("suppliers.activationPending")}{countSuffix}</Badge>;
      case "none":
        return <Badge variant="outline">{t("suppliers.noLogin")}</Badge>;
    }
  }

  const tAny = t as unknown as (k: string) => string;

  const suppliersTable = (
    <>
      {/* Search */}
      <div className="filter-bar">
        <div className="relative flex-1 min-w-[200px]">
          <RiSearchLine className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder={t("suppliers.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Table */}
          <Table stickyHeader>
            <TableHeader>
              <TableRow>
                <TableHead>{t("suppliers.code")}</TableHead>
                <TableHead>{t("suppliers.name")}</TableHead>
                <TableHead>{t("suppliers.company")}</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>{t("suppliers.country")}</TableHead>
                <TableHead>{t("suppliers.accountManager")}</TableHead>
                <TableHead>Growers</TableHead>
                <TableHead>{t("common.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((supplier) => (
                <TableRow
                  key={supplier.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/suppliers/${supplier.id}`)}
                >
                  <TableCell className="font-medium">{supplier.code}</TableCell>
                  <TableCell>{supplier.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {supplier.company || "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {supplier.companyEntity?.name || "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {supplier.country || "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {supplier.commercie ? supplier.commercie.name : "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {supplier.growerCount || "-"}
                  </TableCell>
                  <TableCell>{statusBadge(supplier)}</TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && !loading && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="py-0">
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <RiPlantLine />
                      </div>
                      <p className="empty-state-text">{t("common.noResults")}</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
    </>
  );

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>{t("suppliers.title")}</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>
            <RiAddLine className="mr-2 h-4 w-4" />
            {t("suppliers.newSupplier")}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("suppliers.newSupplier")}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateSupplier} className="space-y-4">
              <div className="space-y-2">
                <Label>{t("suppliers.code")}</Label>
                <Input
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  required
                  placeholder="e.g. PCFUP"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("suppliers.name")}</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>{t("suppliers.company")}</Label>
                <Input
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("suppliers.country")}</Label>
                <Input
                  value={formData.country}
                  onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                />
              </div>
              {companies.length > 0 && (
                <div className="space-y-2">
                  <Label>Brand</Label>
                  <Select
                    value={formData.companyId || "none"}
                    onValueChange={(v) => { if (v !== null) setFormData({ ...formData, companyId: v === "none" ? "" : v }); }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select company" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No company</SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button type="submit" className="w-full">
                {t("suppliers.newSupplier")}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isAdmin ? (
        <Tabs defaultValue="suppliers">
          <TabsList>
            <TabsTrigger value="suppliers">{t("suppliers.title")}</TabsTrigger>
            <TabsTrigger value="fabric-relations">{tAny("fabricRelations.title")}</TabsTrigger>
          </TabsList>
          <TabsContent value="suppliers" className="mt-4">
            {suppliersTable}
          </TabsContent>
          <TabsContent value="fabric-relations" className="mt-4">
            <FabricRelationsTab />
          </TabsContent>
        </Tabs>
      ) : (
        suppliersTable
      )}
    </div>
  );
}
