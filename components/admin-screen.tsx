"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/client";
import { formatRelative } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

interface AdminUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  idpAdmin: boolean;
  blockedAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

interface AdminData {
  users: AdminUser[];
  signupsOpen: boolean;
  maxUsers: number;
}

/** Sign-ups switch and the user list (roles, block / allow again). Admins only. */
export function AdminScreen({ selfId }: { selfId: string }) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const locale = useLocale();
  const now = useNow();
  const [data, setData] = useState<AdminData | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let live = true;
    api<AdminData>("/api/admin/users")
      .then((d) => live && setData(d))
      .catch(() => live && toast.error(tc("error")));
    return () => {
      live = false;
    };
  }, [version, tc]);

  async function setSignups(open: boolean) {
    try {
      await api("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ signupsOpen: open }) });
      reload();
    } catch {
      toast.error(tc("error"));
    }
  }

  async function change(u: AdminUser, patch: { role?: "admin" | "member"; blocked?: boolean }) {
    if (patch.blocked && !window.confirm(t("blockConfirm", { name: u.name ?? u.email }))) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(u.id)}`, { method: "PATCH", body: JSON.stringify(patch) });
      reload();
    } catch {
      toast.error(tc("error"));
    }
  }

  if (!data) return <p className="p-6 text-center text-sm text-muted-foreground">{tc("loading")}</p>;

  const active = data.users.filter((u) => !u.blockedAt);
  const blocked = data.users.filter((u) => u.blockedAt);

  return (
    <div className="space-y-5">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ChevronLeft className="size-4" /> {t("back")}
      </Link>
      <h1 className="text-xl font-semibold">{t("title")}</h1>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label>{t("signups")}</Label>
            <p className="text-xs text-muted-foreground">
              {data.signupsOpen ? t("signupsOpenHint") : t("signupsClosedHint")}
            </p>
          </div>
          <Switch checked={data.signupsOpen} onCheckedChange={setSignups} aria-label={t("signups")} />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("count", { count: data.users.length, max: data.maxUsers })}
        </p>
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("users")}</h2>
        <Card className="gap-0 p-0">
          <ul className="divide-y">
            {active.map((u) => {
              const admin = u.idpAdmin || u.role === "admin";
              const locked = u.id === selfId || u.idpAdmin;
              return (
                <li key={u.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {u.name ?? u.email}
                      {u.id === selfId && <span className="text-muted-foreground"> · {t("you")}</span>}
                    </span>
                    <span className="block break-all text-xs text-muted-foreground">
                      {u.email} · {t("joined", { when: formatRelative(new Date(u.createdAt), locale, now) })}
                      {u.lastSeenAt && <> · {t("seen", { when: formatRelative(new Date(u.lastSeenAt), locale, now) })}</>}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-xs",
                      admin ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {u.idpAdmin ? t("adminIdp") : admin ? t("admin") : t("member")}
                  </span>
                  {!locked && (
                    <span className="flex gap-1">
                      <Button size="xs" variant="outline" onClick={() => change(u, { role: admin ? "member" : "admin" })}>
                        {admin ? t("unmakeAdmin") : t("makeAdmin")}
                      </Button>
                      <Button size="xs" variant="outline" onClick={() => change(u, { blocked: true })}>
                        {t("block")}
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </section>

      {blocked.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t("blocked")}</h2>
          <Card className="gap-0 p-0">
            <ul className="divide-y">
              {blocked.map((u) => (
                <li key={u.id} className="flex items-center gap-2 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{u.name ?? u.email}</span>
                    <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                  </span>
                  <Button size="xs" variant="outline" onClick={() => change(u, { blocked: false })}>
                    {t("allowAgain")}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
