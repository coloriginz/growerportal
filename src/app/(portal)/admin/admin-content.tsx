"use client";

import { UserManagement } from "@/components/layout/user-management";

export function AdminContent() {
  return (
    <UserManagement allowedRoles={["admin", "commercie"]} />
  );
}
