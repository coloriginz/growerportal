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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RiDownloadLine,
  RiFileTextLine,
  RiUploadLine,
} from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import { formatDate, formatFileSize } from "@/lib/format";

interface DocumentRow {
  id: string;
  type: string;
  name: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  createdAt: string;
}

export function DocumentsContent({ growerId }: { growerId: string | null }) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const { t } = useLanguage();

  useEffect(() => {
    async function fetchDocuments() {
      try {
        const params = new URLSearchParams();
        if (growerId) params.set("growerId", growerId);
        const res = await fetch(`/api/documents?${params}`);
        if (res.ok) {
          setDocuments(await res.json());
        }
      } finally {
        setLoading(false);
      }
    }
    fetchDocuments();
  }, [growerId]);

  const filtered =
    typeFilter === "all"
      ? documents
      : documents.filter((d) => d.type === typeFilter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("documents.title")}</h1>
        <Button>
          <RiUploadLine className="mr-2 h-4 w-4" />
          {t("documents.uploadDocument")}
        </Button>
      </div>

      <div className="flex gap-4">
        <Select value={typeFilter} onValueChange={(v) => { if (v !== null) setTypeFilter(v); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("documents.type")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("common.all")}</SelectItem>
            <SelectItem value="salessheet">{t("documents.salessheet")}</SelectItem>
            <SelectItem value="contract">{t("documents.contract")}</SelectItem>
            <SelectItem value="growing_plan">{t("documents.growingPlan")}</SelectItem>
            <SelectItem value="other">{t("documents.other")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("documents.type")}</TableHead>
                <TableHead>{t("documents.name")}</TableHead>
                <TableHead>{t("documents.uploadDate")}</TableHead>
                <TableHead className="text-right">{t("documents.size")}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell>
                    <Badge variant="secondary">{doc.type}</Badge>
                  </TableCell>
                  <TableCell className="flex items-center gap-2">
                    <RiFileTextLine className="text-muted-foreground h-4 w-4" />
                    {doc.name}
                  </TableCell>
                  <TableCell>{formatDate(doc.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    {doc.fileSize ? formatFileSize(doc.fileSize) : "-"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      render={<a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" />}
                    >
                      <RiDownloadLine className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center py-8">
                    {t("common.noResults")}
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
