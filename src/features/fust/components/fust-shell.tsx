"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  RiBox3Line,
  RiTruckLine,
  RiReceiptLine,
  RiLogoutBoxLine,
  RiMenuLine,
  RiGroupLine,
  RiPriceTag3Line,
  RiUserSettingsLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useLanguage } from "@/components/providers/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { ChangePasswordDialog } from "@/components/layout/change-password-dialog";
import { TestBanner } from "@/components/layout/test-banner";
import { isTest } from "@/lib/env";
import { isFustDomainClient, fustHref } from "@/lib/fust-hostname";
import type { Role } from "@/types";

interface FustShellProps {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    growerId: string | null;
    fustEnabled?: boolean;
  };
  children: React.ReactNode;
}

interface NavItem {
  href: string;
  labelKey: string;
  icon: React.ElementType;
  roles?: Role[];
}

const navItems: NavItem[] = [
  { href: "/fust-portal", labelKey: "nav.fustOrders", icon: RiBox3Line, roles: ["grower"] },
  { href: "/fust-portal/orders", labelKey: "nav.fustOrders", icon: RiBox3Line, roles: ["commercie", "admin"] },
  { href: "/fust-portal/pickups", labelKey: "nav.fustPickups", icon: RiTruckLine, roles: ["transporteur"] },
  { href: "/fust-portal/invoices", labelKey: "nav.fustInvoices", icon: RiReceiptLine, roles: ["finance"] },
];

const adminItems: NavItem[] = [
  { href: "/fust-portal/users", labelKey: "admin.users", icon: RiUserSettingsLine, roles: ["admin"] },
  { href: "/fust-portal/settings?tab=growers", labelKey: "fust.growerAccess", icon: RiGroupLine, roles: ["admin"] },
  { href: "/fust-portal/settings?tab=types", labelKey: "fust.fustTypes", icon: RiPriceTag3Line, roles: ["admin"] },
  { href: "/fust-portal/settings?tab=transporters", labelKey: "fust.transporters", icon: RiTruckLine, roles: ["admin"] },
];

export function FustShell({ user, children }: FustShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab");
  const { t } = useLanguage();
  const userRole = user.role as Role;
  const isStandalone = isFustDomainClient();
  const href = (path: string) => fustHref(path, isStandalone);

  const filteredNav = navItems.filter((item) => {
    if (!item.roles?.includes(userRole)) return false;
    if (userRole === "grower" && !user.fustEnabled) return false;
    return true;
  });

  const filteredAdmin = adminItems.filter(
    (item) => !item.roles || item.roles.includes(userRole)
  );

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  function NavContent() {
    return (
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex h-16 items-center px-6">
          <Link href={href("/fust-portal")} onClick={() => setMobileOpen(false)} className="flex items-center gap-2">
            <RiBox3Line className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold tracking-tight">Fust Portal</span>
          </Link>
        </div>

        <Separator className="bg-sidebar-border" />

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {filteredNav.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/fust-portal" && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={href(item.href)}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {t(item.labelKey as Parameters<typeof t>[0])}
              </Link>
            );
          })}
        </nav>

        {/* Admin nav */}
        {filteredAdmin.length > 0 && (
          <>
            <Separator className="bg-sidebar-border" />
            <nav className="space-y-0.5 px-3 py-3">
              {filteredAdmin.map((item) => {
                const [itemPath, itemQuery] = item.href.split("?");
                const itemTab = new URLSearchParams(itemQuery).get("tab");
                const isActive = pathname.startsWith(itemPath) && currentTab === itemTab;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={href(item.href)}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    {t(item.labelKey as Parameters<typeof t>[0])}
                  </Link>
                );
              })}
            </nav>
          </>
        )}

        <Separator className="bg-sidebar-border" />

        {/* User section */}
        <div className="p-4">
          <ChangePasswordDialog>
            <div className="flex items-center gap-3 rounded-lg px-1 py-1 -mx-1 transition-colors hover:bg-sidebar-accent">
              <Avatar className="h-9 w-9 ring-2 ring-sidebar-border">
                <AvatarFallback className="bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 truncate">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="text-sidebar-foreground/50 truncate text-xs">
                  {user.email}
                </p>
              </div>
            </div>
          </ChangePasswordDialog>
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <LanguageSwitcher />
              <ThemeSwitcher />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={async () => {
                await signOut({ redirect: false });
                window.location.href = href("/fust-login");
              }}
              title={t("auth.logout")}
              className="text-sidebar-foreground/60 hover:text-sidebar-foreground"
            >
              <RiLogoutBoxLine className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      {isTest && <TestBanner userRole={userRole} isAdmin={userRole === "admin"} />}
      <div className="flex min-h-0 flex-1">
        {/* Desktop Sidebar */}
        <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border hidden w-64 shrink-0 border-r lg:block">
          <div className="h-full overflow-y-auto">
            <NavContent />
          </div>
        </aside>

        {/* Mobile Sidebar */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64 p-0">
            <NavContent />
          </SheetContent>
        </Sheet>

        {/* Main Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile Header */}
          <header className="bg-sidebar text-sidebar-foreground border-sidebar-border flex h-16 shrink-0 items-center gap-4 border-b px-4 lg:hidden">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen(true)}
            >
              <RiMenuLine className="h-5 w-5" />
            </Button>
            <Link href={href("/fust-portal")} className="flex items-center gap-2">
              <RiBox3Line className="h-5 w-5 text-primary" />
              <span className="font-bold">Fust Portal</span>
            </Link>
          </header>

          {/* Page Content */}
          <main className="flex-1 overflow-y-auto px-6 py-8 lg:px-10">{children}</main>
        </div>
      </div>
    </div>
  );
}
