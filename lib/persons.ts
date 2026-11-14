import { createHash, randomInt } from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { PersonDTO } from "@/lib/types";

export const SHARE_TOKEN_TTL_MS = 24 * 3_600_000;

/** Ensures the user has their undeletable "self" person (and access to it). */
export async function ensureSelfPerson(user: User) {
  const existing = await prisma.person.findUnique({ where: { selfOfUserId: user.id } });
  if (existing) return existing;
  const person = await prisma.person.create({
    data: {
      id: `self_${user.id}`,
      name: user.name ?? user.email,
      kind: "person",
      selfOfUserId: user.id,
      createdById: user.id,
      access: { create: { userId: user.id, reminders: true } },
    },
  });
  if (!user.defaultPersonId) {
    await prisma.user.update({ where: { id: user.id }, data: { defaultPersonId: person.id } });
  }
  return person;
}

export async function hasPersonAccess(userId: string, personId: string) {
  const row = await prisma.personAccess.findUnique({
    where: { personId_userId: { personId, userId } },
  });
  return row !== null;
}

/** Medicine lookup restricted to persons the user can access. */
export function findAccessibleMedicine(userId: string, medicineId: string) {
  return prisma.medicine.findFirst({
    where: { id: medicineId, person: { access: { some: { userId } } } },
  });
}

/** Same, with the person's time zone and day window (needed for any schedule math). */
export function findAccessibleMedicineWithPerson(userId: string, medicineId: string) {
  return prisma.medicine.findFirst({
    where: { id: medicineId, person: { access: { some: { userId } } } },
    include: { person: { select: { id: true, timezone: true, wakeTime: true, bedTime: true } } },
  });
}

/** Dose lookup restricted to persons the user can access. */
export function findAccessibleDose(userId: string, doseId: string) {
  return prisma.doseLog.findFirst({
    where: { id: doseId, medicine: { person: { access: { some: { userId } } } } },
  });
}

/** Resolves the person to operate on: explicit id (if accessible) or the user's default. */
export async function resolvePersonId(user: User, requested: string | null | undefined) {
  if (requested) return (await hasPersonAccess(user.id, requested)) ? requested : null;
  if (user.defaultPersonId && (await hasPersonAccess(user.id, user.defaultPersonId))) {
    return user.defaultPersonId;
  }
  return (await ensureSelfPerson(user)).id;
}

export async function listPersons(user: User): Promise<PersonDTO[]> {
  const persons = await prisma.person.findMany({
    where: { access: { some: { userId: user.id } } },
    include: {
      access: {
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return persons
    .map((p) => toPersonDTO(user, p))
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf));
}

type PersonWithAccess = Awaited<ReturnType<typeof getPersonWithAccess>>;

export function getPersonWithAccess(personId: string) {
  return prisma.person.findUnique({
    where: { id: personId },
    include: {
      access: {
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export function toPersonDTO(user: User, p: NonNullable<PersonWithAccess>): PersonDTO {
  const ownerId = p.selfOfUserId ?? p.createdById;
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    timezone: p.timezone,
    wakeTime: p.wakeTime,
    bedTime: p.bedTime,
    reminders: p.access.find((a) => a.userId === user.id)?.reminders ?? false,
    notifyLogs: p.access.find((a) => a.userId === user.id)?.notifyLogs ?? false,
    isSelf: p.selfOfUserId === user.id,
    isOtherUsersSelf: p.selfOfUserId !== null && p.selfOfUserId !== user.id,
    canDelete: p.selfOfUserId === null && p.createdById === user.id,
    canManageAccess: ownerId === user.id,
    ownerId,
    members: p.access.map((a) => ({
      id: a.user.id,
      name: a.user.name ?? a.user.email,
      email: a.user.email,
      isMe: a.user.id === user.id,
      isOwner: a.user.id === ownerId,
    })),
  };
}

// Unambiguous alphabet (no 0/O/1/I/L). 12 chars ≈ 60 bits; tokens are one-time and
// expire within 24 h.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateShareCode() {
  let raw = "";
  for (let i = 0; i < 12; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

export function normalizeShareCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashShareCode(code: string) {
  return createHash("sha256").update(normalizeShareCode(code)).digest("hex");
}
