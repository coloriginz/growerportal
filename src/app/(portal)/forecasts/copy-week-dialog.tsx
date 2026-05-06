"use client";

import { useState } from "react";
import { useLanguage } from "@/components/providers/language-provider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RiAlertLine, RiLoader4Line } from "@remixicon/react";
import { toast } from "sonner";

interface CopyWeekDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weeksWithData: { year: number; week: number }[];
  supplierId: string | null;
  onCopied: () => void;
}

export function CopyWeekDialog({
  open,
  onOpenChange,
  weeksWithData,
  supplierId,
  onCopied,
}: CopyWeekDialogProps) {
  const { t } = useLanguage();
  const [sourceWeek, setSourceWeek] = useState<string>("");
  const [numberOfWeeks, setNumberOfWeeks] = useState(1);
  const [copying, setCopying] = useState(false);

  const handleCopy = async () => {
    if (!sourceWeek || !supplierId) return;

    const [year, week] = sourceWeek.split("-").map(Number);
    setCopying(true);

    try {
      const res = await fetch("/api/forecasts/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          sourceYear: year,
          sourceWeek: week,
          numberOfWeeks,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Copy failed");
      }

      toast.success(t("forecasts.copied"));
      onCopied();
      onOpenChange(false);
      setSourceWeek("");
      setNumberOfWeeks(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("forecasts.saveError"));
    } finally {
      setCopying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("forecasts.copyWeekTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t("forecasts.sourceWeek")}</Label>
            <Select value={sourceWeek} onValueChange={(v) => setSourceWeek(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder={t("forecasts.sourceWeek")} />
              </SelectTrigger>
              <SelectContent>
                {weeksWithData
                  .sort((a, b) => a.year - b.year || a.week - b.week)
                  .map((w) => (
                    <SelectItem key={`${w.year}-${w.week}`} value={`${w.year}-${w.week}`}>
                      W{w.week} {w.year}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("forecasts.numberOfWeeks")}</Label>
            <Select
              value={String(numberOfWeeks)}
              onValueChange={(v) => setNumberOfWeeks(parseInt(v ?? "1"))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <RiAlertLine className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t("forecasts.copyWarning")}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleCopy} disabled={!sourceWeek || copying}>
            {copying && <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" />}
            {t("forecasts.copy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
