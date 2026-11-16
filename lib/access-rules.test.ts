import { describe, expect, it } from "vitest";
import { adminChangeProblem, decideAccess, safeNext, type GateFacts } from "./access-rules";

const base: GateFacts = {
  groups: [],
  existing: null,
  signupsOpen: true,
  userCount: 10,
  newUsersToday: 0,
  limits: { maxUsers: 100, maxNewUsersPerDay: 5 },
};

describe("decideAccess", () => {
  it("lets a stranger in while sign-ups are open", () => {
    expect(decideAccess(base)).toEqual({ kind: "ok", create: true, isAdmin: false });
  });
  it("refuses a stranger while sign-ups are closed", () => {
    expect(decideAccess({ ...base, signupsOpen: false })).toEqual({ kind: "signups_closed" });
  });
  it("lets household in while sign-ups are closed", () => {
    expect(decideAccess({ ...base, signupsOpen: false, groups: ["household"] }).kind).toBe("ok");
  });
  it("makes the admins group admin, new or existing, even over a block or the caps", () => {
    const g = { ...base, groups: ["admins"], signupsOpen: false, userCount: 100 };
    expect(decideAccess(g)).toEqual({ kind: "ok", create: true, isAdmin: true });
    expect(decideAccess({ ...g, existing: { role: "member", blockedAt: new Date() } })).toEqual({
      kind: "ok",
      create: false,
      isAdmin: true,
    });
  });
  it("keeps existing users in when sign-ups close, with their stored role", () => {
    const f = { ...base, signupsOpen: false };
    expect(decideAccess({ ...f, existing: { role: "member", blockedAt: null } })).toEqual({ kind: "ok", create: false, isAdmin: false });
    expect(decideAccess({ ...f, existing: { role: "admin", blockedAt: null } }).kind === "ok").toBe(true);
    expect(decideAccess({ ...f, existing: { role: "admin", blockedAt: null } })).toMatchObject({ isAdmin: true });
  });
  it("refuses a blocked user, also when sign-ups are open", () => {
    expect(decideAccess({ ...base, existing: { role: "admin", blockedAt: new Date() } })).toEqual({ kind: "removed" });
  });
  it("pauses new accounts at the flood limits (household too), not existing ones", () => {
    expect(decideAccess({ ...base, userCount: 100 })).toEqual({ kind: "full" });
    expect(decideAccess({ ...base, newUsersToday: 5, groups: ["household"] })).toEqual({ kind: "full" });
    expect(decideAccess({ ...base, userCount: 100, existing: { role: "member", blockedAt: null } }).kind).toBe("ok");
  });
});

describe("adminChangeProblem", () => {
  it("protects yourself and Authentik admins", () => {
    expect(adminChangeProblem("a", { id: "a", idpAdmin: false })).toBe("self");
    expect(adminChangeProblem("a", { id: "b", idpAdmin: true })).toBe("idp_admin");
    expect(adminChangeProblem("a", { id: "b", idpAdmin: false })).toBeNull();
  });
});

describe("safeNext", () => {
  it("only allows same-origin paths", () => {
    expect(safeNext("/history")).toBe("/history");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
