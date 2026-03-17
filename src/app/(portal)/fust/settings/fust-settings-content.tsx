"use client";

import { useState } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import { useFetch } from "@/hooks/use-fetch";
import { formatCurrencyDetailed } from "@/lib/format";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { RiCheckLine, RiCloseLine } from "@remixicon/react";
import { toast } from "sonner";

interface FustType {
  id: string;
  code: string;
  name: string;
  category: string;
  pricePerUnit: string;
  isActive: boolean;
  sortOrder: number;
}

interface Transporter {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
}

interface GrowerSetting {
  id: string;
  code: string;
  name: string;
  company: string | null;
  fustEnabled: boolean;
  defaultTransporterId: string | null;
}

interface SettingsData {
  fustTypes: FustType[];
  transporters: Transporter[];
  growers: GrowerSetting[];
}

export function FustSettingsContent() {
  const { t } = useLanguage();
  const { data, loading, refetch } = useFetch<SettingsData>("/api/fust/settings");
  const [saving, setSaving] = useState<string | null>(null);

  const updateSetting = async (body: Record<string, unknown>) => {
    const key = JSON.stringify(body);
    setSaving(key);
    try {
      const res = await fetch("/api/fust/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(t("fust.settingsSaved"));
        refetch();
      } else {
        toast.error("Failed to save");
      }
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(null);
    }
  };

  if (loading || !data) {
    return <Skeleton className="h-96" />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("fust.settings")}</h1>

      <Tabs defaultValue="growers">
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.growers.map((grower) => (
                  <TableRow key={grower.id}>
                    <TableCell className="font-medium">{grower.code}</TableCell>
                    <TableCell>{grower.company || grower.name}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        disabled={saving !== null}
                        onClick={() =>
                          updateSetting({
                            type: "grower",
                            growerId: grower.id,
                            fustEnabled: !grower.fustEnabled,
                          })
                        }
                      >
                        {grower.fustEnabled ? (
                          <Badge variant="default">{t("fust.enabled")}</Badge>
                        ) : (
                          <Badge variant="outline">{t("fust.disabled")}</Badge>
                        )}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={grower.defaultTransporterId || "none"}
                        onValueChange={(v) =>
                          updateSetting({
                            type: "grower",
                            growerId: grower.id,
                            defaultTransporterId: v === "none" ? null : v,
                          })
                        }
                      >
                        <SelectTrigger className="w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("fust.noTransporter")}</SelectItem>
                          {data.transporters
                            .filter((tr) => tr.isActive)
                            .map((tr) => (
                              <SelectItem key={tr.id} value={tr.id}>
                                {tr.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Fust Types */}
        <TabsContent value="types">
          <div className="mt-4 overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("fust.code")}</TableHead>
                  <TableHead>{t("fust.name")}</TableHead>
                  <TableHead>{t("fust.category")}</TableHead>
                  <TableHead className="text-right">{t("fust.price")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.fustTypes.map((ft) => (
                  <TableRow key={ft.id} className={!ft.isActive ? "opacity-50" : ""}>
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
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={saving !== null}
                        onClick={() =>
                          updateSetting({
                            type: "fustType",
                            id: ft.id,
                            isActive: !ft.isActive,
                          })
                        }
                      >
                        {ft.isActive ? (
                          <RiCheckLine className="h-4 w-4 text-green-600" />
                        ) : (
                          <RiCloseLine className="h-4 w-4 text-red-600" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Transporters */}
        <TabsContent value="transporters">
          <div className="mt-4 overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("fust.name")}</TableHead>
                  <TableHead>{t("fust.email")}</TableHead>
                  <TableHead>{t("fust.phone")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.transporters.map((tr) => (
                  <TableRow key={tr.id}>
                    <TableCell className="font-medium">{tr.name}</TableCell>
                    <TableCell>{tr.email || "-"}</TableCell>
                    <TableCell>{tr.phone || "-"}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        disabled={saving !== null}
                        onClick={() =>
                          updateSetting({
                            type: "transporter",
                            id: tr.id,
                            name: tr.name,
                            isActive: !tr.isActive,
                          })
                        }
                      >
                        {tr.isActive ? (
                          <Badge variant="default">{t("fust.active")}</Badge>
                        ) : (
                          <Badge variant="outline">{t("fust.inactive")}</Badge>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
