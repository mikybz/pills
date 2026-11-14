"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, CircleHelp, ClipboardList, History, Pill, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { HelpSheet } from "@/components/help-sheet";
import { LiveProvider } from "@/components/live-provider";
import { useEffect, useState } from "react";
import { syncPushSubscription } from "@/lib/push-client";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MemberAvatars,
  PersonIcon,
  PersonProvider,
  isShared,
  usePersons,
} from "@/components/person-context";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <PersonProvider>
      <LiveProvider>
        <Shell>{children}</Shell>
      </LiveProvider>
    </PersonProvider>
  );
}

function PersonSwitcher() {
  const t = useTranslations("people");
  const router = useRouter();
  const { persons, current, setCurrentId } = usePersons();
  if (!current) return <span className="flex-1" />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="mx-2 flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm hover:bg-accent"
        aria-label={t("switch")}
      >
        <PersonIcon kind={current.kind} className="shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{current.name}</span>
        {isShared(current) && <Users className="size-3.5 shrink-0 text-teal-600 dark:text-teal-400" />}
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("trackingFor")}</DropdownMenuLabel>
          {persons.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => setCurrentId(p.id)} className="py-2">
              <PersonIcon kind={p.kind} className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {p.name}
                {p.isSelf && <span className="text-muted-foreground"> ({t("you")})</span>}
              </span>
              <MemberAvatars person={p} />
              {p.id === current.id && <Check className="size-4 text-teal-600" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/settings#people")}>
          <Users className="text-muted-foreground" /> {t("manage")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [helpOpen, setHelpOpen] = useState(false);

  // Keep this device's push subscription registered for the signed-in user.
  useEffect(() => {
    syncPushSubscription().catch(() => {});
  }, []);

  const tabs = [
    { href: "/", label: t("nav.home"), icon: ClipboardList },
    { href: "/history", label: t("nav.history"), icon: History },
    { href: "/settings", label: t("nav.settings"), icon: Settings },
  ];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/90 px-4 py-3 backdrop-blur">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-xl bg-teal-600 text-white">
            <Pill className="size-5" />
          </span>
          <span className="hidden sm:inline">{t("app.name")}</span>
        </Link>
        <PersonSwitcher />
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          aria-label={t("settings.help")}
          className="rounded-full p-2 text-muted-foreground hover:bg-accent"
        >
          <CircleHelp className="size-5" />
        </button>
      </header>

      <main className="flex-1 px-4 pb-24 pt-4">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto grid max-w-lg grid-cols-3">
          {tabs.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2.5 text-xs",
                  active ? "text-teal-600 dark:text-teal-400" : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>

      <HelpSheet open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
