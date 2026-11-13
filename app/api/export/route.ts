import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser, notFound } from "@/lib/api";
import { resolvePersonId } from "@/lib/persons";
import { historySlots } from "@/lib/schedule";
import { doseAmountOf, segmentsOf, toLogEntries, type MedicineDTO } from "@/lib/types";

interface Row {
  medicine: string;
  mode: string;
  amount: number;
  unit: string;
  takenAt: string | null;
  slotAt: string | null;
  status: string;
  note: string | null;
  loggedBy: string | null;
}

export async function GET(req: NextRequest) {
  return withUser(async (user) => {
    const format = req.nextUrl.searchParams.get("format") ?? "csv";
    const personId = await resolvePersonId(user, req.nextUrl.searchParams.get("personId"));
    if (!personId) return notFound();
    const person = await prisma.person.findUnique({ where: { id: personId } });
    if (!person) return notFound();
    const slug = person.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "export";
    const medicines = await prisma.medicine.findMany({
      where: { personId },
      include: {
        scheduleVersions: true,
        doses: { include: { user: { select: { name: true, email: true } } } },
      },
    });

    const now = Date.now();
    const rows: Row[] = [];
    for (const m of medicines) {
      const mode = m.mode ?? "asNeeded";
      for (const d of m.doses) {
        rows.push({
          medicine: m.name,
          mode,
          amount: d.amount,
          unit: m.unit,
          takenAt: d.takenAt.toISOString(),
          slotAt: d.slotAt?.toISOString() ?? null,
          status: d.status,
          note: d.note,
          loggedBy: d.user.name ?? d.user.email,
        });
      }
      // Missed slots are derived, not stored: add them as rows with status "missed".
      const dto = JSON.parse(JSON.stringify(m)) as MedicineDTO;
      const slots = historySlots(segmentsOf(dto, person, now), toLogEntries(m.doses, m), 0, now, now);
      for (const s of slots) {
        if (s.state !== "missed") continue;
        rows.push({
          medicine: m.name,
          mode,
          amount: doseAmountOf(m),
          unit: m.unit,
          takenAt: null,
          slotAt: new Date(s.slotAt).toISOString(),
          status: "missed",
          note: null,
          loggedBy: null,
        });
      }
    }
    const sortKey = (r: Row) => r.takenAt ?? r.slotAt ?? "";
    rows.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

    if (format === "json") {
      return new NextResponse(JSON.stringify(rows, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="pills-${slug}.json"`,
        },
      });
    }

    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [
      "medicine,mode,amount,unit,taken_at,slot_at,status,note,logged_by",
      ...rows.map((r) =>
        [
          esc(r.medicine),
          r.mode,
          r.amount,
          r.unit,
          r.takenAt ?? "",
          r.slotAt ?? "",
          r.status,
          esc(r.note ?? ""),
          esc(r.loggedBy ?? ""),
        ].join(","),
      ),
    ];
    return new NextResponse(csv.join("\n") + "\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pills-${slug}.csv"`,
      },
    });
  });
}
