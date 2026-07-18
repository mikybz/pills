import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withUser } from "@/lib/api";

export async function GET(req: NextRequest) {
  return withUser(async (user) => {
    const format = req.nextUrl.searchParams.get("format") ?? "csv";
    const doses = await prisma.doseLog.findMany({
      where: { userId: user.id },
      include: { medicine: { select: { name: true, unit: true } } },
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
      }));
      return new NextResponse(JSON.stringify(data, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="pills-export.json"',
        },
      });
    }

    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows = [
      "medicine,amount,unit,taken_at,status,note",
      ...doses.map((d) =>
        [
          esc(d.medicine.name),
          d.amount,
          d.medicine.unit,
          d.takenAt.toISOString(),
          d.status,
          esc(d.note ?? ""),
        ].join(","),
      ),
    ];
    return new NextResponse(rows.join("\n") + "\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="pills-export.csv"',
      },
    });
  });
}
