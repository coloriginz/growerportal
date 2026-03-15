"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { SessionProvider } from "./session-provider";
import { LanguageProvider } from "./language-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <SessionProvider>
        <LanguageProvider>
          <TooltipProvider>
            {children}
            <Toaster position="top-right" richColors />
          </TooltipProvider>
        </LanguageProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
