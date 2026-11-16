import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";

/** Shown instead of the app when the access gate says no (signed in, but not let in). */
export async function GateNotice({ kind }: { kind: "signups_closed" | "full" | "removed" | "email_taken" }) {
  const t = await getTranslations("gate");
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t(kind)}</p>
        {/* A plain link: /logout is a route handler, not a page. */}
        <a href="/logout" className={buttonVariants({ variant: "outline" })}>
          {t("otherAccount")}
        </a>
      </div>
    </main>
  );
}
