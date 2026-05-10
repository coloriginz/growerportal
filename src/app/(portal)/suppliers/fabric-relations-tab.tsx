"use client";

import { useState } from "react";
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
import { Input } from "@/components/ui/input";
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
} from "@/components/ui/dialog";
import {
  RiSearchLine,
  RiAlertLine,
  RiCheckLine,
  RiDatabase2Line,
  RiLoader4Line,
} from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { toast } from "sonner";

interface FabricRelationRow {
  id: string;
  fabricId: number;
  code: string;
  name: string;
  accountManagerName: string | null;
  accountManagerCode: string | null;
  updatedAt: string;
  status: "supplier" | "grower" | "has_data" | "no_data";
  supplierId: string | null;
  supplierCode: string | null;
  growerInfo: { id: string; supplierCode: string; supplierName: string } | null;
  lotCount: number;
  txCount: number;
}

interface ApiResponse {
  relations: FabricRelationRow[];
  summary: {
    total: number;
    suppliers: number;
    growers: number;
    hasData: number;
    noData: number;
  };
  unactivatedWithData: { fabricId: number; code: string; name: string }[];
}

interface CompanyOption {
  id: string;
  name: string;
  slug: string;
}

type StatusFilter = "all" | "supplier" | "grower" | "has_data" | "no_data";

export function FabricRelationsTab() {
  const { t } = useLanguage();
  const tAny = t as unknown as (k: string) => string;

  const { data, loading, refetch } = useFetch<ApiResponse>(
    "/api/admin/fabric-relations"
  );
  const { data: companies } = useFetch<CompanyOption[]>("/api/companies");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [activateRow, setActivateRow] = useState<FabricRelationRow | null>(
    null
  );
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [activating, setActivating] = useState(false);

  const relations = data?.relations ?? [];
  const summary = data?.summary;
  const unactivatedWithData = data?.unactivatedWithData ?? [];

  const filtered = relations.filter((r) => {
    // Status filter
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    // Search filter
    if (search) {
      const q = search.toLowerCase();
      return (
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.accountManagerName &&
          r.accountManagerName.toLowerCase().includes(q))
      );
    }
    return true;
  });

  async function handleActivate() {
    if (!activateRow || !selectedCompanyId) return;
    setActivating(true);
    try {
      const res = await fetch("/api/admin/fabric-relations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fabricId: activateRow.fabricId,
          companyId: selectedCompanyId,
        }),
      });
      if (res.ok) {
        toast.success(
          tAny("fabricRelations.activateSuccess").replace(
            "{{name}}",
            activateRow.name
          )
        );
        setActivateRow(null);
        setSelectedCompanyId("");
        refetch();
      } else {
        const body = await res.json();
        toast.error(body.error || "Error activating relation");
      }
    } catch {
      toast.error("Error activating relation");
    } finally {
      setActivating(false);
    }
  }

  function statusBadge(row: FabricRelationRow) {
    switch (row.status) {
      case "supplier":
        return <Badge variant="default">{tAny("fabricRelations.supplier")}</Badge>;
      case "grower":
        return (
          <Badge variant="secondary">
            {tAny("fabricRelations.growerUnder").replace(
              "{{supplier}}",
              row.supplierCode ?? ""
            )}
          </Badge>
        );
      case "has_data":
        return (
          <Badge
            variant="outline"
            className="border-amber-500/50 text-amber-600 dark:text-amber-400"
          >
            {tAny("fabricRelations.hasData")}
          </Badge>
        );
      case "no_data":
        return (
          <Badge variant="outline" className="text-muted-foreground">
            {tAny("fabricRelations.noData")}
          </Badge>
        );
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RiLoader4Line className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Warning callout for unactivated relations with data */}
      {unactivatedWithData.length > 0 && (
        <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="flex items-start gap-3 p-4">
            <RiAlertLine className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-sm text-amber-800 dark:text-amber-200">
              {tAny("fabricRelations.unactivatedWarning").replace(
                "{{count}}",
                String(unactivatedWithData.length)
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary line */}
      {summary && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            {tAny("fabricRelations.all")}: <strong>{summary.total}</strong>
          </span>
          <span className="text-green-600 dark:text-green-400">
            {tAny("fabricRelations.supplier")}:{" "}
            <strong>{summary.suppliers}</strong>
          </span>
          <span className="text-blue-600 dark:text-blue-400">
            {tAny("fabricRelations.grower")}:{" "}
            <strong>{summary.growers}</strong>
          </span>
          <span className="text-amber-600 dark:text-amber-400">
            {tAny("fabricRelations.hasData")}:{" "}
            <strong>{summary.hasData}</strong>
          </span>
          <span>
            {tAny("fabricRelations.noData")}:{" "}
            <strong>{summary.noData}</strong>
          </span>
        </div>
      )}

      {/* Filter bar */}
      <div className="filter-bar">
        <div className="relative flex-1 min-w-[200px]">
          <RiSearchLine className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder={tAny("suppliers.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            if (v !== null) setStatusFilter(v as StatusFilter);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={tAny("fabricRelations.filterStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tAny("fabricRelations.all")}</SelectItem>
            <SelectItem value="supplier">
              {tAny("fabricRelations.supplier")}
            </SelectItem>
            <SelectItem value="grower">
              {tAny("fabricRelations.grower")}
            </SelectItem>
            <SelectItem value="has_data">
              {tAny("fabricRelations.hasData")}
            </SelectItem>
            <SelectItem value="no_data">
              {tAny("fabricRelations.noData")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tAny("suppliers.code")}</TableHead>
                <TableHead>{tAny("suppliers.name")}</TableHead>
                <TableHead>{tAny("fabricRelations.accountManager")}</TableHead>
                <TableHead>{tAny("fabricRelations.status")}</TableHead>
                <TableHead className="text-right">
                  {tAny("fabricRelations.lots")}
                </TableHead>
                <TableHead className="text-right">
                  {tAny("fabricRelations.transactions")}
                </TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-sm">
                    {row.code}
                  </TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.accountManagerName || "-"}
                  </TableCell>
                  <TableCell>{statusBadge(row)}</TableCell>
                  <TableCell className="text-right">{row.lotCount}</TableCell>
                  <TableCell className="text-right">{row.txCount}</TableCell>
                  <TableCell className="text-right">
                    {row.status !== "supplier" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setActivateRow(row);
                          setSelectedCompanyId("");
                        }}
                      >
                        <RiCheckLine className="mr-1.5 h-4 w-4" />
                        {tAny("fabricRelations.activate")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="py-0">
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <RiDatabase2Line />
                      </div>
                      <p className="empty-state-text">
                        {tAny("common.noResults")}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Activation Dialog */}
      <Dialog
        open={activateRow !== null}
        onOpenChange={(open) => !open && setActivateRow(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tAny("fabricRelations.activate")}</DialogTitle>
          </DialogHeader>
          {activateRow && (
            <div className="space-y-4">
              <div className="rounded-md border p-3 text-sm">
                <div>
                  <span className="text-muted-foreground">
                    {tAny("suppliers.code")}:
                  </span>{" "}
                  <span className="font-mono font-medium">
                    {activateRow.code}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {tAny("suppliers.name")}:
                  </span>{" "}
                  {activateRow.name}
                </div>
                {activateRow.accountManagerName && (
                  <div>
                    <span className="text-muted-foreground">
                      {tAny("fabricRelations.accountManager")}:
                    </span>{" "}
                    {activateRow.accountManagerName}
                  </div>
                )}
              </div>

              {companies && companies.length > 0 && (
                <div className="space-y-2">
                  <Select
                    value={selectedCompanyId || "placeholder"}
                    onValueChange={(v) => {
                      if (v !== null && v !== "placeholder")
                        setSelectedCompanyId(v);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={tAny("fabricRelations.selectCompany")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="placeholder" disabled>
                        {tAny("fabricRelations.selectCompany")}
                      </SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Button
                className="w-full"
                disabled={!selectedCompanyId || activating}
                onClick={handleActivate}
              >
                {activating ? (
                  <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RiCheckLine className="mr-2 h-4 w-4" />
                )}
                {tAny("fabricRelations.activate")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
