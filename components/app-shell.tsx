"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { CircleHelp, ClipboardList, History, Pill, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { HelpSheet } from "@/components/help-sheet";
import { useState } from "react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [helpOpen, setHelpOpen] = useState(false);

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
          {t("app.name")}
        </Link>
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
