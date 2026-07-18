"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArchiveRestore, CircleHelp, LogOut, Pencil, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MedicineDialog } from "@/components/medicine-dialog";
import { HelpSheet } from "@/components/help-sheet";
import { api } from "@/lib/client";
import { colorClasses, type MedicineDTO, type ProfileDTO } from "@/lib/types";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

export function SettingsScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const [medicines, setMedicines] = useState<MedicineDTO[]>([]);
  const [editing, setEditing] = useState<MedicineDTO | null | "new">(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const reload = useCallback(async () => {
    const [p, m] = await Promise.all([
      api<ProfileDTO>("/api/profile"),
      api<MedicineDTO[]>("/api/medicines?archived=true"),
    ]);
    setProfile(p);
    setMedicines(m);
  }, []);

  useEffect(() => {
    reload().catch(() => toast.error(t("common.error")));
  }, [reload, t]);

  const updateProfile = useCallback(
    async (patch: Partial<ProfileDTO>) => {
      try {
        const updated = await api<ProfileDTO>("/api/profile", {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        setProfile(updated);
        toast.success(t("settings.saved"));
      } catch {
        toast.error(t("common.error"));
      }
    },
    [t],
  );

  async function setLocale(value: string) {
    document.cookie = `locale=${value};path=/;max-age=31536000;SameSite=Lax`;
    await updateProfile({ locale: value } as Partial<ProfileDTO>);
    window.location.reload();
  }

  function setTheme(value: string) {
    localStorage.setItem("theme", value);
    document.documentElement.classList.toggle(
      "dark",
      value === "dark" ||
        (value === "system" && matchMedia("(prefers-color-scheme: dark)").matches),
    );
    void updateProfile({ theme: value } as Partial<ProfileDTO>);
  }

  if (!profile) {
    return <p className="py-12 text-center text-muted-foreground">{t("common.loading")}</p>;
  }

  const active = medicines.filter((m) => !m.archivedAt);
  const archived = medicines.filter((m) => m.archivedAt);
  const strictnessValue =
    profile.strictness <= 0.05 ? "strict" : profile.strictness >= 0.22 ? "relaxed" : "normal";

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold">{t("settings.title")}</h1>

      {/* Medicines */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("settings.medicines")}
          </h2>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> {t("settings.newMedicine")}
          </Button>
        </div>
        <Card className="gap-0 p-0">
          <ul className="divide-y">
            {active.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className={cn(
                    "size-3 shrink-0 rounded-full",
                    (colorClasses[m.color] ?? colorClasses.blue).dot,
                  )}
                />
                <span className="flex-1">
                  <span className="font-medium">{m.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`settings.form${m.form.charAt(0).toUpperCase() + m.form.slice(1)}`)} ·{" "}
                    {m.maxPerDay
                      ? `max ${formatAmount(m.maxPerDay)} ${m.unit}/d`
                      : m.unit}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("settings.editMedicine")}
                  onClick={() => setEditing(m)}
                >
                  <Pencil className="size-4" />
                </Button>
              </li>
            ))}
            {active.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                {t("home.noMedicinesHint")}
              </li>
            )}
          </ul>
        </Card>
        {archived.length > 0 && (
          <Card className="gap-0 p-0">
            <h3 className="border-b px-4 py-2 text-xs font-medium text-muted-foreground">
              {t("settings.archived")}
            </h3>
            <ul className="divide-y">
              {archived.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-3 px-4 py-2.5 text-muted-foreground"
                >
                  <span className="flex-1 text-sm">{m.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await api(`/api/medicines/${m.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ unarchive: true }),
                      });
                      void reload();
                    }}
                  >
                    <ArchiveRestore className="size-4" /> {t("settings.restore")}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* Preferences */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t("settings.preferences")}
        </h2>
        <Card className="gap-4 p-4">
          <div className="flex items-center justify-between gap-4">
            <Label>{t("settings.language")}</Label>
            <Select value={locale} onValueChange={(v) => v && setLocale(v)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="nb">Norsk</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label>{t("settings.theme")}</Label>
            <Select value={profile.theme} onValueChange={(v) => v && setTheme(v)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("settings.themeSystem")}</SelectItem>
                <SelectItem value="light">{t("settings.themeLight")}</SelectItem>
                <SelectItem value="dark">{t("settings.themeDark")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label>{t("settings.strictness")}</Label>
            <Select
              value={strictnessValue}
              onValueChange={(v) =>
                v &&
                updateProfile({
                  strictness: v === "strict" ? 0 : v === "relaxed" ? 0.25 : 0.15,
                } as Partial<ProfileDTO>)
              }
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="strict">{t("settings.strictnessStrict")}</SelectItem>
                <SelectItem value="normal">{t("settings.strictnessNormal")}</SelectItem>
                <SelectItem value="relaxed">{t("settings.strictnessRelaxed")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>{t("settings.wakeWindow")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.wakeWindowHint")}</p>
            </div>
            <Select
              value={String(profile.wakeWindowH)}
              onValueChange={(v) =>
                v && updateProfile({ wakeWindowH: Number(v) } as Partial<ProfileDTO>)
              }
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 12, 14, 16, 18].map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {h} h
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>{t("settings.countUncertain")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.countUncertainHint")}
              </p>
            </div>
            <Switch
              checked={profile.countUncertain}
              onCheckedChange={(v) =>
                updateProfile({ countUncertain: v } as Partial<ProfileDTO>)
              }
            />
          </div>
        </Card>
      </section>

      {/* Help & account */}
      <section className="space-y-2">
        <Card className="gap-0 p-0">
          <button
            type="button"
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp className="size-4 text-muted-foreground" /> {t("settings.help")}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 border-t px-4 py-3 text-left hover:bg-accent/50"
            onClick={() => {
              window.location.href = "/api/auth/signout";
            }}
          >
            <LogOut className="size-4 text-muted-foreground" /> {t("settings.signOut")}
            <span className="ml-auto text-sm text-muted-foreground">{profile.email}</span>
          </button>
        </Card>
      </section>

      <MedicineDialog
        medicine={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onChanged={() => {
          setEditing(null);
          void reload();
        }}
      />
      <HelpSheet open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
