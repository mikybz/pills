import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, notFound } from "@/lib/api";
import { resolvePersonId } from "@/lib/persons";

export async function GET(req: NextRequest) {
  return withUser(async (user) => {
    const format = req.nextUrl.searchParams.get("format") ?? "csv";
    const personId = await resolvePersonId(user, req.nextUrl.searchParams.get("personId"));
    if (!personId) return notFound();
    const person = await prisma.person.findUnique({ where: { id: personId } });
    const slug = (person?.name ?? "export").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const doses = await prisma.doseLog.findMany({
      where: { medicine: { personId } },
      include: {
        medicine: { select: { name: true, unit: true } },
        user: { select: { name: true, email: true } },
      },
      orderBy: { takenAt: "asc" },
    });

    if (format === "json") {
      const data = doses.map((d) => ({
        medicine: d.medicine.name,
        amount: d.amount,
        unit: d.medicine.unit,
        takenAt: d.takenAt.toISOString(),
        status: d.status,
        note: d.note,
        loggedBy: d.user.name ?? d.user.email,
      }));
      return new NextResponse(JSON.stringify(data, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="pills-${slug}.json"`,
        },
      });
    }

    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows = [
      "medicine,amount,unit,taken_at,status,note,logged_by",
      ...doses.map((d) =>
        [
          esc(d.medicine.name),
          d.amount,
          d.medicine.unit,
          d.takenAt.toISOString(),
          d.status,
          esc(d.note ?? ""),
          esc(d.user.name ?? d.user.email),
        ].join(","),
      ),
    ];
    return new NextResponse(rows.join("\n") + "\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pills-${slug}.csv"`,
      },
    });
  });
}
