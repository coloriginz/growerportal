"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RiEyeLine, RiEyeOffLine } from "@remixicon/react";
import { useLanguage } from "@/components/providers/language-provider";
import { toast } from "sonner";

export function ChangePasswordDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const { t } = useLanguage();

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrent(false);
    setShowNew(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error(t("profile.passwordMismatch"));
      return;
    }
    if (newPassword.length < 8) {
      toast.error(t("profile.passwordTooShort"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/profile/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.ok) {
        toast.success(t("profile.passwordChanged"));
        reset();
        setOpen(false);
      } else {
        if (res.status === 403) {
          toast.error(t("profile.currentPasswordWrong"));
        } else {
          const data = await res.json();
          toast.error(data.error || "Error");
        }
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger render={<span className="cursor-pointer" />}>
        {children}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("profile.changePassword")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t("profile.currentPassword")}</label>
            <div className="relative">
              <Input
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showCurrent ? <RiEyeOffLine className="h-4 w-4" /> : <RiEyeLine className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t("profile.newPassword")}</label>
            <div className="relative">
              <Input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showNew ? <RiEyeOffLine className="h-4 w-4" /> : <RiEyeLine className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t("profile.confirmPassword")}</label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={saving || !currentPassword || !newPassword || !confirmPassword}
          >
            {saving ? t("common.save") + "..." : t("profile.changePassword")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
