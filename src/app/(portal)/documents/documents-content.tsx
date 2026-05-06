"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RiDeleteBinLine,
  RiDownloadLine,
  RiFileTextLine,
  RiUploadCloudLine,
  RiUploadLine,
} from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import { formatDate, formatFileSize } from "@/lib/format";
import { toast } from "sonner";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

interface DocumentRow {
  id: string;
  type: string;
  name: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  createdAt: string;
}

export function DocumentsContent({ supplierId }: { supplierId: string | null }) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Upload form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [docName, setDocName] = useState("");
  const [docType, setDocType] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { t } = useLanguage();
  const { data: session } = useSession();
  const userRole = session?.user?.role as string | undefined;
  const canManage = userRole === "admin" || userRole === "commercie";

  const fetchDocuments = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (supplierId) params.set("supplierId", supplierId);
      const res = await fetch(`/api/documents?${params}`);
      if (res.ok) {
        setDocuments(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [supplierId]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const filtered =
    typeFilter === "all"
      ? documents
      : documents.filter((d) => d.type === typeFilter);

  function handleFileSelect(file: File | null) {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      toast.error(t("documents.fileTooLarge"));
      return;
    }
    setSelectedFile(file);
    if (!docName) {
      // Auto-fill name from filename (without extension)
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
      setDocName(nameWithoutExt);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFileSelect(file);
  }

  function resetUploadForm() {
    setSelectedFile(null);
    setDocName("");
    setDocType("");
    setDragOver(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleUpload() {
    if (!selectedFile || !supplierId || !docType || !docName) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("supplierId", supplierId);
      formData.append("type", docType);
      formData.append("name", docName);

      const res = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      toast.success(t("documents.uploadSuccess"));
      setUploadOpen(false);
      resetUploadForm();
      await fetchDocuments();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("documents.uploadError")
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(docId: string) {
    if (!confirm(t("documents.deleteConfirm"))) return;

    setDeletingId(docId);
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Delete failed");
      }

      toast.success(t("documents.deleteSuccess"));
      await fetchDocuments();
    } catch {
      toast.error(t("documents.deleteError"));
    } finally {
      setDeletingId(null);
    }
  }

  const docTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      salessheet: t("documents.salessheet"),
      contract: t("documents.contract"),
      growing_plan: t("documents.growingPlan"),
      other: t("documents.other"),
    };
    return labels[type] || type;
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>{t("documents.title")}</h1>
        {canManage && supplierId && (
          <Button
            onClick={() => {
              resetUploadForm();
              setUploadOpen(true);
            }}
          >
            <RiUploadLine className="mr-2 h-4 w-4" />
            {t("documents.uploadDocument")}
          </Button>
        )}
      </div>

      <div className="filter-bar">
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
                    <Badge variant="secondary">{docTypeLabel(doc.type)}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <RiFileTextLine className="text-muted-foreground h-4 w-4 shrink-0" />
                      <span className="font-medium">{doc.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(doc.createdAt)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {doc.fileSize ? formatFileSize(doc.fileSize) : "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        render={
                          <a
                            href={`/api/documents/${doc.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          />
                        }
                      >
                        <RiDownloadLine className="h-4 w-4" />
                      </Button>
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={deletingId === doc.id}
                          onClick={() => handleDelete(doc.id)}
                        >
                          <RiDeleteBinLine className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && !loading && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="py-0">
                    <div className="empty-state">
                      <div className="empty-state-icon">
                        <RiFileTextLine />
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

      {/* Upload Dialog */}
      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open);
          if (!open) resetUploadForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("documents.uploadTitle")}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
            {/* Drag & Drop / File Select */}
            <div
              className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors cursor-pointer ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-muted-foreground/50"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <RiUploadCloudLine className="h-8 w-8 text-muted-foreground" />
              {selectedFile ? (
                <div className="text-center">
                  <p className="text-sm font-medium">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(selectedFile.size)}
                  </p>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">
                    {t("documents.selectFile")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("documents.maxFileSize")}
                  </p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
              />
            </div>

            {/* Document Name */}
            <div className="grid gap-2">
              <Label htmlFor="doc-name">{t("documents.documentName")}</Label>
              <Input
                id="doc-name"
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder={t("documents.documentName")}
              />
            </div>

            {/* Document Type */}
            <div className="grid gap-2">
              <Label>{t("documents.documentType")}</Label>
              <Select value={docType} onValueChange={(v) => { if (v !== null) setDocType(v); }}>
                <SelectTrigger>
                  <SelectValue placeholder={t("documents.selectType")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="salessheet">{t("documents.salessheet")}</SelectItem>
                  <SelectItem value="contract">{t("documents.contract")}</SelectItem>
                  <SelectItem value="growing_plan">{t("documents.growingPlan")}</SelectItem>
                  <SelectItem value="other">{t("documents.other")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={handleUpload}
              disabled={!selectedFile || !docName || !docType || uploading}
            >
              {uploading ? (
                <>
                  <RiUploadLine className="mr-2 h-4 w-4 animate-spin" />
                  {t("documents.uploading")}
                </>
              ) : (
                <>
                  <RiUploadLine className="mr-2 h-4 w-4" />
                  {t("common.upload")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
