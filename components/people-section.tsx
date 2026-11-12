"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, KeyRound, Pencil, Plus, Share2, Star, Trash2, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MemberAvatars,
  PersonIcon,
  initials,
  isShared,
  usePersons,
} from "@/components/person-context";
import { api } from "@/lib/client";
import { formatDay, formatTime } from "@/lib/format";
import { PERSON_KINDS, type PersonDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PeopleSection() {
  const t = useTranslations("people");
  const tc = useTranslations("common");
  const { persons, current, defaultPersonId, setCurrentId, reload, setDefaultPersonId } =
    usePersons();
  const searchParams = useSearchParams();
  const [editing, setEditing] = useState<PersonDTO | "new" | null>(null);
  const [sharing, setSharing] = useState<PersonDTO | null>(null);
  // Deep link: /settings?join=CODE opens the join dialog prefilled.
  const [joinCode, setJoinCode] = useState(() => searchParams.get("join") ?? "");
  const [joinOpen, setJoinOpen] = useState(() => searchParams.get("join") !== null);
  useEffect(() => {
    if (searchParams.get("join")) window.history.replaceState(null, "", "/settings#people");
  }, [searchParams]);

  const effectiveDefault =
    defaultPersonId && persons.some((p) => p.id === defaultPersonId)
      ? defaultPersonId
      : persons.find((p) => p.isSelf)?.id;

  return (
    <section id="people" className="scroll-mt-20 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("title")}</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setJoinOpen(true)}>
            <KeyRound className="size-4" /> {t("addWithCode")}
          </Button>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> {t("new")}
          </Button>
        </div>
      </div>
      <Card className="gap-0 p-0">
        <ul className="divide-y">
          {persons.map((p) => {
            const isDefault = p.id === effectiveDefault;
            return (
              <li
                key={p.id}
                className={cn(
                  "flex items-center gap-2 px-4 py-3",
                  p.id === current?.id && "bg-teal-600/5",
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => setCurrentId(p.id)}
                >
                  <PersonIcon kind={p.kind} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {p.name}
                      {p.isSelf && (
                        <span className="font-normal text-muted-foreground"> ({t("you")})</span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t(`kind_${p.kind}`)}
                      {isShared(p) && (
                        <>
                          {" · "}
                          <span className="text-teal-700 dark:text-teal-400">
                            {t("sharedWith", {
                              names: p.members
                                .filter((m) => !m.isMe)
                                .map((m) => m.name)
                                .join(", "),
                            })}
                          </span>
                        </>
                      )}
                      {isDefault && <> · {t("defaultBadge")}</>}
                    </span>
                  </span>
                  <MemberAvatars person={p} />
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("makeDefault")}
                  title={t("makeDefault")}
                  onClick={async () => {
                    try {
                      await setDefaultPersonId(p.id);
                      toast.success(t("defaultSet", { name: p.name }));
                    } catch {
                      toast.error(tc("error"));
                    }
                  }}
                >
                  <Star
                    className={cn("size-4", isDefault && "fill-amber-400 text-amber-500")}
                  />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("share")}
                  onClick={() => setSharing(p)}
                >
                  <Share2 className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("edit")}
                  onClick={() => setEditing(p)}
                >
                  <Pencil className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>

      {editing !== null && (
        <PersonDialog
          person={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onChanged={async (createdId) => {
            setEditing(null);
            await reload();
            if (createdId) setCurrentId(createdId);
          }}
        />
      )}
      {sharing && <ShareDialog person={sharing} onClose={() => setSharing(null)} />}
      <JoinDialog
        open={joinOpen}
        code={joinCode}
        setCode={setJoinCode}
        onClose={() => {
          setJoinOpen(false);
          setJoinCode("");
        }}
        onJoined={async (p) => {
          setJoinOpen(false);
          setJoinCode("");
          await reload();
          setCurrentId(p.id);
          toast.success(t("joined", { name: p.name }));
        }}
      />
    </section>
  );
}

function PersonDialog({
  person,
  onClose,
  onChanged,
}: {
  person: PersonDTO | null;
  onClose: () => void;
  onChanged: (createdId?: string) => void;
}) {
  const t = useTranslations("people");
  const tc = useTranslations("common");
  const [name, setName] = useState(person?.name ?? "");
  const [kind, setKind] = useState<string>(person?.kind ?? "person");
  const [timezone, setTimezone] = useState(
    () => person?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [busy, setBusy] = useState(false);
  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf("timeZone");
    return all.includes(timezone) ? all : [timezone, ...all];
  }, [timezone]);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await api<PersonDTO>(person ? `/api/persons/${person.id}` : "/api/persons", {
        method: person ? "PATCH" : "POST",
        body: JSON.stringify({ name: name.trim(), kind, timezone }),
      });
      onChanged(person ? undefined : res.id);
    } catch {
      toast.error(tc("error"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!person || !confirm(t("deleteConfirm", { name: person.name }))) return;
    try {
      await api(`/api/persons/${person.id}`, { method: "DELETE" });
      toast.success(t("deleted"));
      onChanged();
    } catch {
      toast.error(tc("error"));
    }
  }

  async function removeMember(userId: string, self: boolean) {
    if (!person) return;
    if (!confirm(self ? t("leaveConfirm", { name: person.name }) : t("removeConfirm"))) return;
    try {
      await api(`/api/persons/${person.id}/members/${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
      onChanged();
    } catch {
      toast.error(tc("error"));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-sm overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{person ? t("edit") : t("new")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">{t("name")}</Label>
            <Input
              value={name}
              autoFocus={!person}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">{t("kind")}</Label>
            <div className="grid grid-cols-4 gap-2">
              {PERSON_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs",
                    kind === k
                      ? "border-teal-600 bg-teal-600/10 text-teal-700 dark:text-teal-300"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  <PersonIcon kind={k} className="size-5" />
                  {t(`kind_${k}`)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block" htmlFor="person-tz">
              {t("timezone")}
            </Label>
            <select
              id="person-tz"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm"
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">{t("timezoneHint")}</p>
          </div>

          {person && (
            <div>
              <Label className="mb-1.5 flex items-center gap-1.5">
                <Users className="size-4" /> {t("members")}
              </Label>
              <ul className="divide-y rounded-xl border">
                {person.members.map((m) => {
                  const canRemove = !m.isOwner && (m.isMe || person.canManageAccess);
                  return (
                    <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-teal-600 text-[10px] font-semibold text-white">
                        {initials(m.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          {m.name}
                          {m.isMe && <span className="text-muted-foreground"> ({t("you")})</span>}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {m.isOwner ? t("owner") : m.email}
                        </span>
                      </span>
                      {canRemove && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeMember(m.id, m.isMe)}
                        >
                          {m.isMe ? t("leave") : t("remove")}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {person.members.length === 1 && (
                <p className="mt-1 text-xs text-muted-foreground">{t("notShared")}</p>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="flex-row gap-2">
          {person?.canDelete && (
            <Button variant="destructive" onClick={remove}>
              <Trash2 className="size-4" /> {t("delete")}
            </Button>
          )}
          <Button className="flex-1" disabled={busy || !name.trim()} onClick={save}>
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({ person, onClose }: { person: PersonDTO; onClose: () => void }) {
  const t = useTranslations("people");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [share, setShare] = useState<{ code: string; expiresAt: string } | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let alive = true;
    api<{ code: string; expiresAt: string }>(`/api/persons/${person.id}/share`, { method: "POST" })
      .then((s) => alive && setShare(s))
      .catch(() => toast.error(tc("error")));
    return () => {
      alive = false;
    };
  }, [person.id, round, tc]);

  const generate = () => {
    setShare(null);
    setRound((r) => r + 1);
  };

  const link = share
    ? `${window.location.origin}/settings?join=${encodeURIComponent(share.code)}`
    : "";

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(tc("error"));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>{t("shareTitle", { name: person.name })}</DialogTitle>
          <DialogDescription>{t("shareHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-xl border bg-muted/40 px-4 py-5 text-center">
            <div className="font-mono text-2xl font-semibold tracking-widest select-all">
              {share?.code ?? "····-····-····"}
            </div>
            {share && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t("expires", {
                  time: `${formatDay(new Date(share.expiresAt), locale)} ${formatTime(new Date(share.expiresAt), locale)}`,
                })}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={!share} onClick={() => copy(share!.code)}>
              <Copy className="size-4" /> {t("copyCode")}
            </Button>
            <Button
              variant="outline"
              disabled={!share}
              onClick={async () => {
                if (navigator.share) {
                  try {
                    await navigator.share({ title: t("shareTitle", { name: person.name }), url: link });
                    return;
                  } catch {
                    // fall through to copy
                  }
                }
                void copy(link);
              }}
            >
              <Share2 className="size-4" /> {t("shareLink")}
            </Button>
          </div>
        </div>
        <DialogFooter className="flex-row gap-2">
          <Button variant="ghost" onClick={generate}>
            {t("newCode")}
          </Button>
          <Button className="flex-1" onClick={onClose}>
            {tc("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JoinDialog({
  open,
  code,
  setCode,
  onClose,
  onJoined,
}: {
  open: boolean;
  code: string;
  setCode: (c: string) => void;
  onClose: () => void;
  onJoined: (p: PersonDTO) => void;
}) {
  const t = useTranslations("people");
  const tc = useTranslations("common");
  const [busy, setBusy] = useState(false);

  async function join() {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const person = await api<PersonDTO>("/api/persons/join", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      onJoined(person);
    } catch (e) {
      toast.error(e instanceof Error && e.message === "invalid_code" ? t("invalidCode") : tc("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>{t("addWithCode")}</DialogTitle>
          <DialogDescription>{t("joinHint")}</DialogDescription>
        </DialogHeader>
        <Input
          value={code}
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="ABCD-EFGH-JKMN"
          className="text-center font-mono text-lg tracking-widest uppercase"
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && join()}
        />
        <DialogFooter className="flex-row gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button className="flex-1" disabled={busy || !code.trim()} onClick={join}>
            {t("join")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
