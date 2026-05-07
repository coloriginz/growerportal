import {
  RiBox3Line,
  RiTruckLine,
  RiReceiptLine,
  RiSettings3Line,
} from "@remixicon/react";
import type { Role } from "@/types";

export interface FustNavItem {
  href: string;
  labelKey: string;
  icon: React.ElementType;
  roles: Role[];
}

export const fustNavItems: FustNavItem[] = [
  { href: "/fust", labelKey: "nav.fustOrders", icon: RiBox3Line, roles: ["supplier"] },
  { href: "/fust/orders", labelKey: "nav.fustOrders", icon: RiBox3Line, roles: ["commercie", "admin"] },
  { href: "/fust/pickups", labelKey: "nav.fustPickups", icon: RiTruckLine, roles: ["transporteur"] },
  { href: "/fust/invoices", labelKey: "nav.fustInvoices", icon: RiReceiptLine, roles: ["finance"] },
];

export const fustAdminNavItems: FustNavItem[] = [
  { href: "/fust/settings", labelKey: "nav.fustSettings", icon: RiSettings3Line, roles: ["admin"] },
];
