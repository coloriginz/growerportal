"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RiPlantLine, RiSearchLine } from "@remixicon/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/components/providers/language-provider";
import { Suspense } from "react";

interface GrowerOption {
  id: string;
  code: string;
  name: string;
  company: string | null;
}

function GrowerSelectorInner() {
  const [growers, setGrowers] = useState<GrowerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  const selectedGrowerId = searchParams.get("growerId") || "";

  useEffect(() => {
    async function fetchGrowers() {
      try {
        const res = await fetch("/api/growers");
        if (res.ok) {
          const data = await res.json();
          setGrowers(data);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchGrowers();
  }, []);

  function handleChange(growerId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (growerId) {
      params.set("growerId", growerId);
    } else {
      params.delete("growerId");
    }
    router.push(`?${params.toString()}`);
  }

  if (loading) {
    return (
      <div className="bg-muted h-10 animate-pulse rounded-md" />
    );
  }

  return (
    <Select value={selectedGrowerId} onValueChange={(v) => { if (v !== null) handleChange(v); }}>
      <SelectTrigger className="w-full">
        <div className="flex items-center gap-2 truncate">
          <RiPlantLine className="text-muted-foreground h-4 w-4 shrink-0" />
          {selectedGrowerId ? (
            (() => {
              const g = growers.find((g) => g.id === selectedGrowerId);
              return g ? (
                <span className="truncate">
                  <span className="font-medium">{g.code}</span>
                  <span className="text-muted-foreground ml-2">{g.company || g.name}</span>
                </span>
              ) : (
                <SelectValue placeholder={t("nav.selectGrower")} />
              );
            })()
          ) : (
            <span className="text-muted-foreground">{t("nav.selectGrower")}</span>
          )}
        </div>
      </SelectTrigger>
      <SelectContent>
        {growers.map((grower) => (
          <SelectItem key={grower.id} value={grower.id}>
            <span className="font-medium">{grower.code}</span>
            <span className="text-muted-foreground ml-2">
              {grower.company || grower.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function GrowerSelector() {
  return (
    <Suspense fallback={<div className="bg-muted h-10 animate-pulse rounded-md" />}>
      <GrowerSelectorInner />
    </Suspense>
  );
}
