"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Cat, Dog, PawPrint, User } from "lucide-react";
import { api } from "@/lib/client";
import type { PersonDTO, ProfileDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

// The selected person survives navigation within a browser session; a fresh app
// start opens the user's default person.
const SESSION_KEY = "pills.personId";

interface PersonContextValue {
  persons: PersonDTO[];
  current: PersonDTO | null;
  defaultPersonId: string | null;
  /** The signed-in user's id. */
  meId: string | null;
  setCurrentId: (id: string) => void;
  reload: () => Promise<PersonDTO[]>;
  setDefaultPersonId: (id: string) => Promise<void>;
}

const PersonContext = createContext<PersonContextValue | null>(null);

function readSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeSession(id: string) {
  try {
    sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    // ignore (private mode etc.)
  }
}

function fetchPersons() {
  return Promise.all([api<PersonDTO[]>("/api/persons"), api<ProfileDTO>("/api/profile")]);
}

export function PersonProvider({ children }: { children: React.ReactNode }) {
  const [persons, setPersons] = useState<PersonDTO[]>([]);
  const [defaultPersonId, setDefault] = useState<string | null>(null);
  const [currentId, setCurrentIdState] = useState<string | null>(null);

  const apply = useCallback((list: PersonDTO[], profile: ProfileDTO) => {
    setPersons(list);
    setDefault(profile.defaultPersonId);
    setCurrentIdState((prev) => {
      const candidates = [prev, readSession(), profile.defaultPersonId];
      const found = candidates.find((id) => id && list.some((p) => p.id === id));
      return found ?? list.find((p) => p.isSelf)?.id ?? list[0]?.id ?? null;
    });
  }, []);

  const reload = useCallback(async () => {
    const [list, profile] = await fetchPersons();
    apply(list, profile);
    return list;
  }, [apply]);

  useEffect(() => {
    let alive = true;
    fetchPersons()
      .then(([list, profile]) => alive && apply(list, profile))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [apply]);

  const setCurrentId = useCallback((id: string) => {
    writeSession(id);
    setCurrentIdState(id);
  }, []);

  const setDefaultPersonId = useCallback(async (id: string) => {
    await api("/api/profile", {
      method: "PATCH",
      body: JSON.stringify({ defaultPersonId: id }),
    });
    setDefault(id);
  }, []);

  const value = useMemo<PersonContextValue>(
    () => ({
      persons,
      current: persons.find((p) => p.id === currentId) ?? null,
      defaultPersonId,
      meId: persons.flatMap((p) => p.members).find((m) => m.isMe)?.id ?? null,
      setCurrentId,
      reload,
      setDefaultPersonId,
    }),
    [persons, currentId, defaultPersonId, setCurrentId, reload, setDefaultPersonId],
  );

  return <PersonContext.Provider value={value}>{children}</PersonContext.Provider>;
}

export function usePersons() {
  const ctx = useContext(PersonContext);
  if (!ctx) throw new Error("usePersons must be used inside PersonProvider");
  return ctx;
}

export function isShared(p: PersonDTO) {
  return p.members.length > 1;
}

export function PersonIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = kind === "dog" ? Dog : kind === "cat" ? Cat : kind === "other" ? PawPrint : User;
  return <Icon className={cn("size-4", className)} />;
}

/** Small stacked initials of the members other than me. */
export function MemberAvatars({ person, className }: { person: PersonDTO; className?: string }) {
  const others = person.members.filter((m) => !m.isMe);
  if (!others.length) return null;
  return (
    <span className={cn("flex -space-x-1.5", className)} title={others.map((m) => m.name).join(", ")}>
      {others.slice(0, 3).map((m) => (
        <span
          key={m.id}
          className="flex size-5 items-center justify-center rounded-full border-2 border-background bg-teal-600 text-[9px] font-semibold uppercase text-white"
        >
          {initials(m.name)}
        </span>
      ))}
      {others.length > 3 && (
        <span className="flex size-5 items-center justify-center rounded-full border-2 border-background bg-muted text-[9px] font-semibold">
          +{others.length - 3}
        </span>
      )}
    </span>
  );
}

export function initials(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}
