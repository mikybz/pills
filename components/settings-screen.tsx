"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  LogOut,
  Pencil,
  Plus,
} from "lucide-react";
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
import { PeopleSection } from "@/components/people-section";
import { RemindersSection } from "@/components/reminders-section";
import { usePersons } from "@/components/person-context";
import { api } from "@/lib/client";
import { describeSchedule } from "@/lib/describe";
import { usePushSupport } from "@/lib/push-client";
import { isFinished } from "@/lib/schedule";
import { colorClasses, MEDICINE_COLORS, scheduleOf, type MedicineDTO, type ProfileDTO } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

export function SettingsScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const { current } = usePersons();
  const personId = current?.id;
  const timeZone = current?.timezone ?? "Europe/Oslo";
  const now = useNow();
  const support = usePushSupport();
  const [profile, setProfile] = useState<ProfileDTO | null>(null);
  const [medicines, setMedicines] = useState<{ personId: string; list: MedicineDTO[] } | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const [editing, setEditing] = useState<MedicineDTO | null | "new">(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (!personId) return;
    let alive = true;
    Promise.all([
      api<ProfileDTO>("/api/profile"),
      api<MedicineDTO[]>(`/api/medicines?personId=${encodeURIComponent(personId)}&archived=true`),
    ])
      .then(([p, list]) => {
        if (!alive) return;
        setProfile(p);
        setMedicines({ personId, list });
      })
      .catch(() => toast.error(t("common.error")));
    return () => {
      alive = false;
    };
  }, [personId, version, t]);

  const updateProfile = useCallback(
    async (patch: Partial<ProfileDTO>) => {
      try {
        const updated = await api<ProfileDTO>("/api/profile", { method: "PATCH", body: JSON.stringify(patch) });
        setProfile(updated);
        toast.success(t("settings.saved"));
      } catch {
        toast.error(t("common.error"));
      }
    },
    [t],
  );

  const list = medicines && medicines.personId === personId ? medicines.list : [];
  const setList = (fn: (l: MedicineDTO[]) => MedicineDTO[]) =>
    setMedicines((m) => (m ? { ...m, list: fn(m.list) } : m));

  async function moveMedicine(id: string, direction: -1 | 1) {
    const activeIds = list.filter((m) => !m.archivedAt).map((m) => m.id);
    const from = activeIds.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= activeIds.length) return;
    [activeIds[from], activeIds[to]] = [activeIds[to], activeIds[from]];
    const rank = new Map(activeIds.map((mid, i) => [mid, i]));
    setList((prev) =>
      [...prev]
        .map((m) => (rank.has(m.id) ? { ...m, sortOrder: rank.get(m.id)! } : m))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    );
    try {
      await api("/api/medicines/reorder", { method: "PUT", body: JSON.stringify({ ids: activeIds }) });
    } catch {
      toast.error(t("common.error"));
      reload();
    }
  }

  async function setHidden(id: string, hidden: boolean) {
    setList((prev) => prev.map((m) => (m.id === id ? { ...m, hidden } : m)));
    try {
      await api(`/api/medicines/${id}`, { method: "PATCH", body: JSON.stringify({ hidden }) });
    } catch {
      toast.error(t("common.error"));
      reload();
    }
  }

  async function archive(id: string) {
    try {
      await api(`/api/medicines/${id}`, { method: "DELETE" });
      reload();
    } catch {
      toast.error(t("common.error"));
    }
  }

  async function setLocale(value: string) {
    document.cookie = `locale=${value};path=/;max-age=31536000;SameSite=Lax`;
    await updateProfile({ locale: value });
    window.location.reload();
  }

  function setTheme(value: string) {
    localStorage.setItem("theme", value);
    document.documentElement.classList.toggle(
      "dark",
      value === "dark" || (value === "system" && matchMedia("(prefers-color-scheme: dark)").matches),
    );
    void updateProfile({ theme: value });
  }

  if (!profile) {
    return <p className="py-12 text-center text-muted-foreground">{t("common.loading")}</p>;
  }

  const active = list.filter((m) => !m.archivedAt);
  const archived = list.filter((m) => m.archivedAt);

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold">{t("settings.title")}</h1>

      <PeopleSection />

      <section id="medicines" className="scroll-mt-20 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            {current ? t("people.medicinesFor", { name: current.name }) : t("settings.medicines")}
          </h2>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> {t("medicine.new")}
          </Button>
        </div>
        <Card className="gap-0 p-0">
          <ul className="divide-y">
            {active.map((m, i) => {
              const finished = isFinished(scheduleOf(m, timeZone), now);
              return (
                <li key={m.id} className={cn("flex items-center gap-1 py-3 pl-4 pr-2", m.hidden && "opacity-60")}>
                  <span className={cn("mr-1 size-3 shrink-0 rounded-full", (colorClasses[m.color] ?? colorClasses.blue).dot)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{m.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {describeSchedule(m, t, locale)}
                      {m.mode && !m.scheduleReviewedAt && <> · {t("review.needsReview")}</>}
                      {m.hidden && <> · {t("settings.hiddenBadge")}</>}
                    </span>
                    {finished && (
                      <span className="mt-1 flex items-center gap-2 text-xs">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{t("settings.finished")}</span>
                        <Button size="xs" variant="outline" onClick={() => archive(m.id)}>
                          <Archive className="size-3" /> {t("medicine.archive")}
                        </Button>
                      </span>
                    )}
                  </span>
                  <Button variant="ghost" size="icon" aria-label={t("settings.moveUp")} disabled={i === 0} onClick={() => moveMedicine(m.id, -1)}>
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("settings.moveDown")}
                    disabled={i === active.length - 1}
                    onClick={() => moveMedicine(m.id, 1)}
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                  <Switch checked={!m.hidden} aria-label={t("settings.showOnHome")} onCheckedChange={(v) => setHidden(m.id, !v)} />
                  <Button variant="ghost" size="icon" aria-label={t("medicine.edit")} onClick={() => setEditing(m)}>
                    <Pencil className="size-4" />
                  </Button>
                </li>
              );
            })}
            {active.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">{t("home.noMedicinesHint")}</li>
            )}
          </ul>
        </Card>
        {archived.length > 0 && (
          <Card className="gap-0 p-0">
            <h3 className="border-b px-4 py-2 text-xs font-medium text-muted-foreground">{t("settings.archived")}</h3>
            <ul className="divide-y">
              {archived.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-muted-foreground">
                  <span className="flex-1 text-sm">{m.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await api(`/api/medicines/${m.id}`, { method: "PATCH", body: JSON.stringify({ unarchive: true }) });
                      reload();
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

      <RemindersSection profile={profile} updateProfile={updateProfile} />

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("settings.preferences")}</h2>
        <Card className="gap-4 p-4">
          <div className="flex items-center justify-between gap-4">
            <Label>{t("settings.language")}</Label>
            <Select value={locale} onValueChange={(v) => v && setLocale(v)}>
              <SelectTrigger className="w-36">
                <SelectValue>{(v: string) => (v === "nb" ? "Norsk" : "English")}</SelectValue>
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
                <SelectValue>{(v: string) => t(`settings.theme_${v}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("settings.theme_system")}</SelectItem>
                <SelectItem value="light">{t("settings.theme_light")}</SelectItem>
                <SelectItem value="dark">{t("settings.theme_dark")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>{t("settings.countUncertain")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.countUncertainHint")}</p>
            </div>
            <Switch checked={profile.countUncertain} onCheckedChange={(v) => updateProfile({ countUncertain: v })} />
          </div>
        </Card>
      </section>

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

      {editing !== null && (
        <MedicineDialog
          medicine={editing === "new" ? null : editing}
          personId={personId}
          timeZone={timeZone}
          showReminderSwitch={support === "supported" && profile.remindersOn}
          defaultColor={
            MEDICINE_COLORS.find((c) => !active.some((m) => m.color === c)) ??
            MEDICINE_COLORS[active.length % MEDICINE_COLORS.length]
          }
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      <HelpSheet open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
