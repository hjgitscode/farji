import { describe, expect, it } from "vitest";
import { syncAppUser } from "@/lib/auth/user-sync";
import { makeFakeDb } from "./fakes";

const AUTH_ID = "33333333-3333-4333-8333-333333333333";

describe("syncAppUser", () => {
  it("3. creates a new auth user as CANDIDATE and writes an audit event", async () => {
    const { db, users, audits } = makeFakeDb();
    const { user, created } = await syncAppUser(db, AUTH_ID);

    expect(created).toBe(true);
    expect(user.role).toBe("CANDIDATE");
    expect(users).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "USER_CREATED", targetType: "User", actorRole: "CANDIDATE" });
  });

  it("does not accept a role from the caller (the function has no role parameter)", async () => {
    const { db, users } = makeFakeDb();
    // Extra arguments are ignored at runtime; the role is always CANDIDATE.
    await (syncAppUser as unknown as (db: unknown, id: string, role: string) => Promise<unknown>)(db, AUTH_ID, "ADMIN");
    expect(users[0].role).toBe("CANDIDATE");
  });

  it("4. repeated sync is idempotent and never duplicates the user", async () => {
    const { db, users, audits } = makeFakeDb();
    await syncAppUser(db, AUTH_ID);
    const second = await syncAppUser(db, AUTH_ID);
    expect(second.created).toBe(false);
    expect(users).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  it("4. never overwrites an existing ISSUER or ADMIN role", async () => {
    for (const role of ["ISSUER", "ADMIN"] as const) {
      const { db, users, userCreates } = makeFakeDb({ users: [{ id: "u1", authUserId: AUTH_ID, role, status: "ACTIVE" }] });
      const { user, created } = await syncAppUser(db, AUTH_ID);
      expect(created).toBe(false);
      expect(user.role).toBe(role);
      expect(users[0].role).toBe(role);
      expect(userCreates).toHaveLength(0);
    }
  });

  it("returns the winner when a concurrent request creates the user first", async () => {
    const { db, users, hooks } = makeFakeDb();
    hooks.beforeCreate = () => {
      users.push({ id: "winner", authUserId: AUTH_ID, role: "CANDIDATE", status: "ACTIVE" });
    };
    const { user, created } = await syncAppUser(db, AUTH_ID);
    expect(created).toBe(false);
    expect(user.id).toBe("winner");
    expect(users).toHaveLength(1);
  });
});
