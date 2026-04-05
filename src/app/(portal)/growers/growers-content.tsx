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
import { RiAddLine, RiSearchLine, RiPlantLine } from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import { toast } from "sonner";

interface GrowerRow {
  id: string;
  code: string;
  name: string;
  company: string | null;
  country: string | null;
  commercie: { id: string; name: string } | null;
  loginStatus: "active" | "pending" | "none";
  userCount: number;
}

export function GrowersContent() {
  const [growers, setGrowers] = useState<GrowerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { t } = useLanguage();
  const router = useRouter();

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    company: "",
    country: "",
  });

  useEffect(() => {
    fetchGrowers();
  }, []);

  async function fetchGrowers() {
    try {
      const res = await fetch("/api/growers?full=1");
      if (res.ok) {
        setGrowers(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateGrower(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/growers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        toast.success(t("growers.created"));
        setDialogOpen(false);
        setFormData({ code: "", name: "", company: "", country: "" });
        fetchGrowers();
      } else {
        const data = await res.json();
        toast.error(data.error || "Error creating grower");
      }
    } catch {
      toast.error("Error creating grower");
    }
  }

  const filtered = growers.filter((g) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      g.code.toLowerCase().includes(q) ||
      g.name.toLowerCase().includes(q) ||
      (g.company && g.company.toLowerCase().includes(q))
    );
  });

  function statusBadge(grower: GrowerRow) {
    const countSuffix = grower.userCount > 1 ? ` (${grower.userCount})` : "";
    switch (grower.loginStatus) {
      case "active":
        return <Badge variant="default">{t("growers.active")}{countSuffix}</Badge>;
      case "pending":
        return <Badge variant="secondary">{t("growers.activationPending")}{countSuffix}</Badge>;
      case "none":
        return <Badge variant="outline">{t("growers.noLogin")}</Badge>;
    }
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>{t("growers.title")}</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>
            <RiAddLine className="mr-2 h-4 w-4" />
            {t("growers.newGrower")}
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("growers.newGrower")}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateGrower} className="space-y-4">
              <div className="space-y-2">
                <Label>{t("growers.code")}</Label>
                <Input
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  required
                  placeholder="e.g. PCFUP"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("growers.name")}</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>{t("growers.company")}</Label>
                <Input
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("growers.country")}</Label>
                <Input
                  value={formData.country}
                  onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                />
              </div>
              <Button type="submit" className="w-full">
                {t("growers.newGrower")}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="filter-bar">
        <div className="relative flex-1 min-w-[200px]">
          <RiSearchLine className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder={t("growers.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("growers.code")}</TableHead>
                <TableHead>{t("growers.name")}</TableHead>
                <TableHead>{t("growers.company")}</TableHead>
                <TableHead>{t("growers.country")}</TableHead>
                <TableHead>{t("growers.accountManager")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((grower) => (
                <TableRow
                  key={grower.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/growers/${grower.id}`)}
                >
                  <TableCell className="font-medium">{grower.code}</TableCell>
                  <TableCell>{grower.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {grower.company || "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {grower.country || "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {grower.commercie ? grower.commercie.name : "-"}
                  </TableCell>
                  <TableCell>{statusBadge(grower)}</TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && !loading && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="py-0">
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
        </CardContent>
      </Card>
    </div>
  );
}
