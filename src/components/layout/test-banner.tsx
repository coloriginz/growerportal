"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { RiMailLine, RiArrowDownSLine, RiUserLine, RiBuilding2Line } from "@remixicon/react";
import { ROLES } from "@/types";
import type { Role } from "@/types";

const ROLE_LABELS: Record<Role, string> = {
  grower: "Grower",
  commercie: "Commercie",
  admin: "Admin",
  transporteur: "Transporteur",
  finance: "Finance",
};

interface TestBannerProps {
  userRole: string;
  isAdmin: boolean;
}

export function TestBanner({ userRole, isAdmin }: TestBannerProps) {
  return (
    <div className="flex items-center justify-center gap-3 bg-red-600 px-4 py-1.5 text-xs font-semibold tracking-wide text-white">
      <span className="flex-1 text-center uppercase">Test Environment</span>
      <div className="flex items-center gap-2">
        <RoleSwitcher currentRole={userRole} />
        {isAdmin && <EmailSwitcher />}
      </div>
    </div>
  );
}

// ─── Role Switcher with Entity Selection ──────────────────

interface GrowerOption {
  id: string;
  code: string;
  name: string;
  company: string | null;
}

interface TransporterOption {
  id: string;
  name: string;
}

function RoleSwitcher({ currentRole }: { currentRole: string }) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { data: session, update } = useSession();

  // Prefetch entity lists (fetched once while admin role is still active)
  const [growers, setGrowers] = useState<GrowerOption[]>([]);
  const [transporters, setTransporters] = useState<TransporterOption[]>([]);
  const [entityOpen, setEntityOpen] = useState(false);
  const entityRef = useRef<HTMLDivElement>(null);

  // Track current entity display name
  const currentEntityName = (() => {
    if (currentRole === "grower" && session?.user?.growerId) {
      const g = growers.find((g) => g.id === session.user.growerId);
      return g ? `${g.code}` : null;
    }
    if (currentRole === "transporteur" && session?.user?.transporterId) {
      const t = transporters.find((t) => t.id === session.user.transporterId);
      return t?.name || null;
    }
    return null;
  })();

  // Prefetch growers + transporters on mount
  useEffect(() => {
    Promise.all([
      fetch("/api/growers").then((r) => r.ok ? r.json() : []),
      fetch("/api/transporters").then((r) => r.ok ? r.json() : []),
    ]).then(([g, t]) => {
      setGrowers(Array.isArray(g) ? g : g.growers || []);
      setTransporters(Array.isArray(t) ? t : []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
      if (entityRef.current && !entityRef.current.contains(e.target as Node)) {
        setEntityOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSwitch = useCallback(async (role: string) => {
    if (role === currentRole || switching) return;
    setSwitching(true);
    try {
      await update({ switchRole: role });
      router.refresh();
      window.location.reload();
    } finally {
      setSwitching(false);
      setOpen(false);
    }
  }, [currentRole, switching, update, router]);

  const handleEntitySwitch = useCallback(async (entityId: string, entityType: "grower" | "transporter") => {
    if (switching) return;
    setSwitching(true);
    try {
      if (entityType === "grower") {
        const grower = growers.find((g) => g.id === entityId);
        await update({
          switchGrowerId: entityId,
          switchGrowerCode: grower?.code || null,
        });
      } else {
        await update({ switchTransporterId: entityId });
      }
      router.refresh();
      window.location.reload();
    } finally {
      setSwitching(false);
      setEntityOpen(false);
    }
  }, [switching, growers, update, router]);

  const showEntitySelector = currentRole === "grower" || currentRole === "transporteur";
  const entityList = currentRole === "grower" ? growers : transporters;

  return (
    <div className="flex items-center gap-1.5">
      {/* Role dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => { setOpen(!open); setEntityOpen(false); }}
          disabled={switching}
          className="flex items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs font-medium text-white transition hover:bg-white/20 disabled:opacity-50"
        >
          <RiUserLine className="h-3.5 w-3.5" />
          <span>{ROLE_LABELS[currentRole as Role] ?? currentRole}</span>
          <RiArrowDownSLine className="h-3.5 w-3.5" />
        </button>

        {open && (
          <div className="absolute right-0 top-full z-50 mt-2 w-48 rounded-lg border border-gray-200 bg-white py-1 text-gray-900 shadow-xl">
            <p className="px-3 py-1.5 text-xs font-semibold text-gray-500">Switch role</p>
            {ROLES.map((role) => (
              <button
                key={role}
                onClick={() => handleSwitch(role)}
                disabled={switching}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-gray-50 disabled:opacity-50 ${
                  role === currentRole ? "bg-red-50 font-medium text-red-700" : "text-gray-700"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${role === currentRole ? "bg-red-500" : "bg-transparent"}`} />
                {ROLE_LABELS[role]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Entity selector (shown for grower/transporteur roles) */}
      {showEntitySelector && entityList.length > 0 && (
        <div className="relative" ref={entityRef}>
          <button
            onClick={() => { setEntityOpen(!entityOpen); setOpen(false); }}
            disabled={switching}
            className="flex items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs font-medium text-white transition hover:bg-white/20 disabled:opacity-50"
          >
            <RiBuilding2Line className="h-3.5 w-3.5" />
            <span>{currentEntityName || "Select..."}</span>
            <RiArrowDownSLine className="h-3.5 w-3.5" />
          </button>

          {entityOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 max-h-64 w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 text-gray-900 shadow-xl">
              <p className="px-3 py-1.5 text-xs font-semibold text-gray-500">
                {currentRole === "grower" ? "Select grower" : "Select transporter"}
              </p>
              {currentRole === "grower"
                ? (growers as GrowerOption[]).map((g) => {
                    const isSelected = session?.user?.growerId === g.id;
                    return (
                      <button
                        key={g.id}
                        onClick={() => handleEntitySwitch(g.id, "grower")}
                        disabled={switching}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-gray-50 disabled:opacity-50 ${
                          isSelected ? "bg-red-50 font-medium text-red-700" : "text-gray-700"
                        }`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${isSelected ? "bg-red-500" : "bg-transparent"}`} />
                        <span className="truncate">
                          <span className="font-mono text-xs">{g.code}</span>
                          {" "}
                          {g.company || g.name}
                        </span>
                      </button>
                    );
                  })
                : (transporters as TransporterOption[]).map((t) => {
                    const isSelected = session?.user?.transporterId === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => handleEntitySwitch(t.id, "transporter")}
                        disabled={switching}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-gray-50 disabled:opacity-50 ${
                          isSelected ? "bg-red-50 font-medium text-red-700" : "text-gray-700"
                        }`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${isSelected ? "bg-red-500" : "bg-transparent"}`} />
                        <span className="truncate">{t.name}</span>
                      </button>
                    );
                  })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Email Switcher ────────────────────────────────────────

function EmailSwitcher() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"ethereal" | "redirect">("ethereal");
  const [redirectEmail, setRedirectEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/admin/settings?keys=test_email_mode,test_email_redirect")
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        if (data.test_email_mode === "redirect") setMode("redirect");
        if (data.test_email_redirect) setRedirectEmail(data.test_email_redirect);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          test_email_mode: mode,
          test_email_redirect: redirectEmail,
        }),
      });
    } finally {
      setSaving(false);
      setOpen(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs font-medium text-white transition hover:bg-white/20"
      >
        <RiMailLine className="h-3.5 w-3.5" />
        <span>Mail: {mode === "ethereal" ? "Test inbox" : "Redirect"}</span>
        <RiArrowDownSLine className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-gray-200 bg-white p-4 text-gray-900 shadow-xl">
          <p className="mb-2 text-xs font-semibold text-gray-500">Email provider</p>

          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
            <input
              type="radio"
              name="emailMode"
              checked={mode === "ethereal"}
              onChange={() => setMode("ethereal")}
              className="accent-red-600"
            />
            <span className="text-sm">Test inbox (Ethereal)</span>
          </label>

          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
            <input
              type="radio"
              name="emailMode"
              checked={mode === "redirect"}
              onChange={() => setMode("redirect")}
              className="accent-red-600"
            />
            <span className="text-sm">Real mail (enter address)</span>
          </label>

          {mode === "redirect" && (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Email recipient
              </label>
              <input
                type="email"
                value={redirectEmail}
                onChange={(e) => setRedirectEmail(e.target.value)}
                placeholder="Email address..."
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving || (mode === "redirect" && !redirectEmail)}
            className="mt-3 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>

          <p className="mt-2 text-center text-xs text-gray-400">
            {mode === "ethereal"
              ? "Emails go to Ethereal test inbox"
              : redirectEmail
                ? `All emails redirect to ${redirectEmail}`
                : "No address set"}
          </p>
        </div>
      )}
    </div>
  );
}
