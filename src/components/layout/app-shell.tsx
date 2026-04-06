"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  RiDashboardLine,
  RiShoppingCartLine,
  RiStackLine,
  RiFileTextLine,
  RiShieldCheckLine,
  RiUserLine,
  RiUserSettingsLine,
  RiLogoutBoxLine,
  RiMenuLine,
  RiPlantLine,
  RiCalendarScheduleLine,
  RiBox3Line,
  RiTruckLine,
  RiReceiptLine,
  RiSettings3Line,
  RiArrowDownSLine,
  RiGroupLine,
  RiPriceTag3Line,
  RiLink,
  RiHistoryLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useLanguage } from "@/components/providers/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { GrowerSelector } from "@/components/layout/grower-selector";
import { TestBanner } from "@/components/layout/test-banner";
import { OfflineIndicator } from "@/components/layout/offline-indicator";
import { ChangePasswordDialog } from "@/components/layout/change-password-dialog";
import { useCompanyBranding } from "@/components/providers/company-provider";
import { isTest } from "@/lib/env";
import type { Role } from "@/types";

interface AppShellProps {
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
  children?: NavItem[];
}

const mainNavItems: NavItem[] = [
  { href: "/dashboard", labelKey: "nav.dashboard", icon: RiDashboardLine },
  { href: "/sales", labelKey: "nav.sales", icon: RiShoppingCartLine },
  { href: "/lots", labelKey: "nav.lots", icon: RiStackLine },
  { href: "/documents", labelKey: "nav.documents", icon: RiFileTextLine },
  { href: "/quality", labelKey: "nav.quality", icon: RiShieldCheckLine },
  { href: "/forecasts", labelKey: "nav.forecasts", icon: RiCalendarScheduleLine },
  { href: "/profile", labelKey: "nav.profile", icon: RiUserLine },
];

const fustNavItems: NavItem[] = [
  { href: "/fust", labelKey: "nav.fustCatalogue", icon: RiPriceTag3Line, roles: ["commercie", "admin"] },
  { href: "/fust", labelKey: "nav.fustOrder", icon: RiShoppingCartLine, roles: ["grower"] },
  { href: "/fust/my-orders", labelKey: "nav.fustMyOrders", icon: RiBox3Line, roles: ["grower"] },
  { href: "/fust/deliveries", labelKey: "nav.fustDeliveries", icon: RiTruckLine, roles: ["grower"] },
  { href: "/fust/orders", labelKey: "nav.fustOrders", icon: RiBox3Line, roles: ["commercie", "admin", "finance"] },
  { href: "/fust/pickups", labelKey: "nav.fustPickups", icon: RiTruckLine, roles: ["transporteur", "finance"] },
  { href: "/fust/vouchers", labelKey: "nav.fustVouchers", icon: RiFileTextLine, roles: ["finance", "admin"] },
  { href: "/fust/matching", labelKey: "nav.fustMatching", icon: RiLink, roles: ["finance", "admin"] },
  { href: "/fust/invoices", labelKey: "nav.fustInvoices", icon: RiReceiptLine, roles: ["finance", "admin"] },
  { href: "/fust/activity", labelKey: "nav.fustActivity", icon: RiHistoryLine, roles: ["admin", "finance"] },
];

const bottomNavItems: NavItem[] = [
  {
    href: "/growers",
    labelKey: "nav.growers",
    icon: RiPlantLine,
    roles: ["admin", "commercie", "finance"],
  },
  {
    href: "/admin",
    labelKey: "nav.users",
    icon: RiUserSettingsLine,
    roles: ["admin"],
  },
  {
    href: "/fust/settings",
    labelKey: "nav.fustSettings",
    icon: RiSettings3Line,
    roles: ["admin"],
    children: [
      { href: "/fust/settings?tab=growers", labelKey: "fust.growerAccess", icon: RiGroupLine },
      { href: "/fust/settings?tab=types", labelKey: "fust.fustTypes", icon: RiPriceTag3Line },
      { href: "/fust/settings?tab=transporters", labelKey: "fust.transporters", icon: RiTruckLine },
    ],
  },
];

export function AppShell({ user, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [fustSettingsOpen, setFustSettingsOpen] = useState(() =>
    typeof window !== "undefined" && window.location.pathname.startsWith("/fust/settings")
  );
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const company = useCompanyBranding();
  const growerId = searchParams.get("growerId");
  const userRole = user.role as Role;
  const showGrowerSelector = userRole === "admin" || userRole === "commercie" || userRole === "finance";

  const portalRoles: Role[] = ["grower", "commercie", "admin", "finance"];
  const filteredMainNav = mainNavItems.filter(
    (item) => !item.roles || item.roles.includes(userRole)
  ).filter((item) => {
    // Transporteur only sees fust items, no main portal pages
    if (!portalRoles.includes(userRole)) return false;
    return true;
  });

  // Fust nav: growers only see it if fustEnabled, others see by role
  const filteredFustNav = fustNavItems.filter((item) => {
    if (!item.roles?.includes(userRole)) return false;
    if (userRole === "grower" && !user.fustEnabled) return false;
    return true;
  });

  const filteredBottomNav = bottomNavItems.filter(
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
        {/* Logo */}
        <div className="flex h-16 items-center px-6">
          <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
            <Image src={company.logoPath} alt={company.name} width={140} height={38} className="dark:brightness-0 dark:invert" />
          </Link>
        </div>

        <Separator className="bg-sidebar-border" />

        {/* Grower Selector (admin/commercie only) */}
        {showGrowerSelector && (
          <div className="px-4 py-3">
            <p className="text-sidebar-foreground/60 mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider">
              {t("nav.selectGrower")}
            </p>
            <GrowerSelector />
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {filteredMainNav.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={growerId ? `${item.href}?growerId=${growerId}` : item.href}
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

          {/* Fust nav items */}
          {filteredFustNav.length > 0 && (
            <>
              <Separator className="bg-sidebar-border !my-3" />
              {filteredFustNav.map((item) => {
                const isActive = item.href === "/fust" ? pathname === "/fust" : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.labelKey}
                    href={growerId ? `${item.href}?growerId=${growerId}` : item.href}
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
            </>
          )}
        </nav>

        {/* Bottom nav (internal only) */}
        {filteredBottomNav.length > 0 && (
          <>
            <Separator className="bg-sidebar-border" />
            <nav className="space-y-0.5 px-3 py-3">
              {filteredBottomNav.map((item) => {
                const isActive = pathname.startsWith(item.href);
                const Icon = item.icon;

                // Collapsible item with children
                if (item.children) {
                  const currentTab = searchParams.get("tab");
                  return (
                    <div key={item.href}>
                      <button
                        onClick={() => {
                          setFustSettingsOpen(!fustSettingsOpen);
                          if (!isActive) {
                            // Navigate to the first child
                          }
                        }}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        }`}
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0" />
                        <span className="flex-1 text-left">{t(item.labelKey as Parameters<typeof t>[0])}</span>
                        <RiArrowDownSLine className={`h-4 w-4 shrink-0 transition-transform ${fustSettingsOpen ? "rotate-180" : ""}`} />
                      </button>
                      {fustSettingsOpen && (
                        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-3">
                          {item.children.map((child) => {
                            const [childPath, childQuery] = child.href.split("?");
                            const childTab = new URLSearchParams(childQuery).get("tab");
                            const isChildActive = pathname.startsWith(childPath) && currentTab === childTab;
                            const ChildIcon = child.icon;
                            return (
                              <Link
                                key={child.href}
                                href={child.href}
                                onClick={() => setMobileOpen(false)}
                                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 ${
                                  isChildActive
                                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                                }`}
                              >
                                <ChildIcon className="h-4 w-4 shrink-0" />
                                {t(child.labelKey as Parameters<typeof t>[0])}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.href}
                    href={item.href}
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
              onClick={() => signOut({ callbackUrl: `${window.location.origin}/login` })}
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
      {/* Test Environment Banner */}
      <OfflineIndicator />
      {isTest && <TestBanner userRole={userRole} />}

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
          <Link href="/dashboard">
            <Image src={company.logoPath} alt={company.name} width={120} height={32} className="dark:brightness-0 dark:invert" />
          </Link>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto px-6 py-8 lg:px-10">{children}</main>
      </div>
      </div>
    </div>
  );
}
