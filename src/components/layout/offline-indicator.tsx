"use client";

import { useEffect, useState } from "react";
import { RiWifiOffLine } from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";

export function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    setIsOffline(!navigator.onLine);

    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="flex items-center justify-center gap-2 bg-yellow-500 px-4 py-2 text-sm font-medium text-white">
      <RiWifiOffLine className="h-4 w-4" />
      {t("common.offline")}
    </div>
  );
}
