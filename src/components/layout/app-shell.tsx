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
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useLanguage } from "@/components/providers/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { GrowerSelector } from "@/components/layout/grower-selector";
import { TestBanner } from "@/components/layout/test-banner";
import { OfflineIndicator } from "@/components/layout/offline-indicator";
import { isTest } from "@/lib/env";
import type { Role } from "@/types";

interface AppShellProps {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    growerId: string | null;
  };
  children: React.ReactNode;
}

interface NavItem {
  href: string;
  labelKey: string;
  icon: React.ElementType;
  roles?: Role[];
}

const mainNavItems: NavItem[] = [
  { href: "/dashboard", labelKey: "nav.dashboard", icon: RiDashboardLine },
  { href: "/sales", labelKey: "nav.sales", icon: RiShoppingCartLine },
  { href: "/lots", labelKey: "nav.lots", icon: RiStackLine },
  { href: "/documents", labelKey: "nav.documents", icon: RiFileTextLine },
  { href: "/quality", labelKey: "nav.quality", icon: RiShieldCheckLine },
  { href: "/profile", labelKey: "nav.profile", icon: RiUserLine },
];

const bottomNavItems: NavItem[] = [
  {
    href: "/growers",
    labelKey: "nav.growers",
    icon: RiPlantLine,
    roles: ["admin", "commercie"],
  },
  {
    href: "/admin",
    labelKey: "nav.users",
    icon: RiUserSettingsLine,
    roles: ["admin"],
  },
];

export function AppShell({ user, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const growerId = searchParams.get("growerId");
  const userRole = user.role as Role;
  const showGrowerSelector = userRole === "admin" || userRole === "commercie";

  const filteredMainNav = mainNavItems.filter(
    (item) => !item.roles || item.roles.includes(userRole)
  );
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
          <Image src="/logo.png" alt="Coloriginz" width={140} height={38} />
        </div>

        <Separator className="bg-sidebar-border" />

        {/* Grower Selector (admin/commercie only) */}
        {showGrowerSelector && (
          <div className="px-4 py-3">
            <GrowerSelector />
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {filteredMainNav.map((item) => {
            const isActive = pathname.startsWith(item.href);
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
        </nav>

        {/* Bottom nav (internal only) */}
        {filteredBottomNav.length > 0 && (
          <>
            <Separator className="bg-sidebar-border" />
            <nav className="space-y-0.5 px-3 py-3">
              {filteredBottomNav.map((item) => {
                const isActive = pathname.startsWith(item.href);
                const Icon = item.icon;
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
          <div className="flex items-center gap-3">
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
          <div className="mt-3 flex items-center justify-between">
            <LanguageSwitcher />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => signOut({ callbackUrl: "/login" })}
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
    <div className="flex min-h-screen flex-col">
      {/* Test Environment Banner */}
      <OfflineIndicator />
      {isTest && <TestBanner isAdmin={userRole === "admin"} />}

      <div className="flex flex-1">
      {/* Desktop Sidebar */}
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border hidden w-64 shrink-0 border-r lg:block">
        <div className="sticky top-0 h-screen overflow-y-auto">
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
      <div className="flex flex-1 flex-col">
        {/* Mobile Header */}
        <header className="bg-sidebar text-sidebar-foreground border-sidebar-border flex h-16 items-center gap-4 border-b px-4 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(true)}
          >
            <RiMenuLine className="h-5 w-5" />
          </Button>
          <Image src="/logo.png" alt="Coloriginz" width={120} height={32} />
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto px-6 py-8 lg:px-10">{children}</main>
      </div>
      </div>
    </div>
  );
}
