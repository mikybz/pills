"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellRing, Share, SquarePlus } from "lucide-react";
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
import { PersonIcon, usePersons } from "@/components/person-context";
import { api } from "@/lib/client";
import { formatDuration } from "@/lib/format";
import { usePushSupport, useDevicePush } from "@/lib/push-client";
import type { ProfileDTO } from "@/lib/types";

const LEAD_OPTIONS = [0, 5, 10, 15, 30];
const NAG_OPTIONS = [0, 5, 10, 15, 30];
const NAG_MAX_OPTIONS = [30, 60, 120, 180, 240, 360];

/**
 * Reminders: one global switch always; everything else only on a device that
 * can show notifications (no dead settings). Stored values keep applying on the
 * user's other devices.
 */
export function RemindersSection({
  profile,
  updateProfile,
}: {
  profile: ProfileDTO;
  updateProfile: (patch: Partial<ProfileDTO>) => Promise<void>;
}) {
  const t = useTranslations();
  const { persons, reload } = usePersons();
  const support = usePushSupport();
  const device = useDevicePush(support);
  const [busy, setBusy] = useState(false);

  const minutes = (m: number) => (m === 0 ? t("reminders.off") : formatDuration(m * 60_000, t));

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error && e.message === "push_not_configured" ? t("reminders.notConfigured") : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function setPersonReminders(personId: string, on: boolean) {
    await run(async () => {
      await api(`/api/persons/${encodeURIComponent(personId)}/access`, {
        method: "PATCH",
        body: JSON.stringify({ reminders: on }),
      });
      await reload();
    });
  }

  const choice = (label: string, value: number, options: number[], key: keyof ProfileDTO) => (
    <div className="flex items-center justify-between gap-4">
      <Label>{label}</Label>
      <Select value={String(value)} onValueChange={(v) => v !== null && updateProfile({ [key]: Number(v) } as Partial<ProfileDTO>)}>
        <SelectTrigger className="w-32">
          <SelectValue>{(v: string) => minutes(Number(v))}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={String(o)}>
              {minutes(o)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <section id="reminders" className="scroll-mt-20 space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">{t("reminders.title")}</h2>
      <Card className="gap-4 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label>{t("reminders.globalSwitch")}</Label>
            <p className="text-xs text-muted-foreground">{t("reminders.globalHint")}</p>
          </div>
          <Switch checked={profile.remindersOn} onCheckedChange={(v) => updateProfile({ remindersOn: v })} />
        </div>

        {profile.remindersOn && support === "ios-install" && (
          <div className="space-y-1.5 rounded-lg bg-muted p-3 text-sm">
            <p className="font-medium">{t("reminders.iosTitle")}</p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li className="flex-wrap">
                {t("reminders.iosStep1")} <Share className="inline size-4 align-text-bottom" />
              </li>
              <li>
                {t("reminders.iosStep2")} <SquarePlus className="inline size-4 align-text-bottom" />
              </li>
              <li>{t("reminders.iosStep3")}</li>
            </ol>
          </div>
        )}
        {profile.remindersOn && support === "unsupported" && (
          <p className="text-sm text-muted-foreground">{t("reminders.unsupported")}</p>
        )}

        {profile.remindersOn && support === "supported" && (
          <>
            <div className="flex items-center justify-between gap-4 border-t pt-4">
              <div>
                <Label>{t("reminders.thisDevice")}</Label>
                <p className="text-xs text-muted-foreground">
                  {device.state === "on"
                    ? t("reminders.deviceOn")
                    : device.state === "denied"
                      ? t("reminders.deviceDenied")
                      : t("reminders.deviceOff")}
                </p>
              </div>
              {device.state === "on" ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(device.disable)}>
                  {t("reminders.turnOff")}
                </Button>
              ) : device.state === "off" ? (
                <Button size="sm" disabled={busy} onClick={() => run(device.enable)}>
                  <BellRing className="size-4" /> {t("reminders.enableHere")}
                </Button>
              ) : null}
            </div>

            {choice(t("reminders.lead"), profile.remindLeadMin, LEAD_OPTIONS, "remindLeadMin")}
            {choice(t("reminders.nagEvery"), profile.nagEveryMin, NAG_OPTIONS, "nagEveryMin")}
            {profile.nagEveryMin > 0 &&
              choice(t("reminders.nagMax"), profile.nagMaxMin, NAG_MAX_OPTIONS, "nagMaxMin")}

            <Button
              variant="outline"
              size="sm"
              disabled={busy || device.state !== "on"}
              onClick={() =>
                run(async () => {
                  await api("/api/push/test", { method: "POST" });
                  toast.success(t("reminders.testSent"));
                })
              }
            >
              {t("reminders.test")}
            </Button>

            <div className="space-y-2 border-t pt-4">
              <div>
                <Label>{t("reminders.perPerson")}</Label>
                <p className="text-xs text-muted-foreground">{t("reminders.perPersonHint")}</p>
              </div>
              <ul className="space-y-2">
                {persons.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <PersonIcon kind={p.kind} className="text-muted-foreground" />
                    <span className="flex-1 truncate text-sm">
                      {p.name}
                      {p.isSelf && <span className="text-muted-foreground"> ({t("people.you")})</span>}
                    </span>
                    <Switch
                      checked={p.reminders}
                      disabled={busy}
                      aria-label={t("reminders.forPerson", { name: p.name })}
                      onCheckedChange={(v) => setPersonReminders(p.id, v)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
