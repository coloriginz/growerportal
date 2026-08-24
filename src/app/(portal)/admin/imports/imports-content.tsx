"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/components/providers/language-provider";
import { DataSyncTab } from "./data-sync-tab";
import { SchedulesTab } from "./schedules-tab";
import { SalesSheetImportsTab } from "./salessheet-tab";

export function ImportsContent() {
  const { t } = useLanguage();

  return (
    <div className="page-content">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("imports.title")}
        </h1>
      </div>
      <Tabs defaultValue="data-sync">
        <TabsList>
          <TabsTrigger value="data-sync">Data Sync</TabsTrigger>
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
          <TabsTrigger value="sales-sheets">Sales Sheets</TabsTrigger>
        </TabsList>
        <TabsContent value="data-sync" className="mt-6">
          <DataSyncTab />
        </TabsContent>
        <TabsContent value="schedules" className="mt-6">
          <SchedulesTab />
        </TabsContent>
        <TabsContent value="sales-sheets" className="mt-6">
          <SalesSheetImportsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
