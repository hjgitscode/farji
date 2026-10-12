import type { PrismaClient } from "@/lib/database/generated/client";

// Ensures an authenticated Supabase user has exactly one FARJI User row.
//
// Security rules:
// - The only input is the VERIFIED Supabase user id. There is deliberately no role
//   parameter: a new row is always CANDIDATE. ISSUER / ADMIN are assigned only by a
//   trusted administrative path (a later phase), never by this function.
// - An existing row is returned untouched. A role is never overwritten on login.
// - Email is not copied; it stays in Supabase Auth only.

export type SyncDb = Pick<PrismaClient, "user" | "auditEvent" | "$transaction">;

export type AppUserRecord = {
  id: string;
  authUserId: string;
  role: "CANDIDATE" | "ISSUER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
};

const SELECT = { id: true, authUserId: true, role: true, status: true } as const;

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

export async function syncAppUser(db: SyncDb, authUserId: string): Promise<{ user: AppUserRecord; created: boolean }> {
  const existing = await db.user.findUnique({ where: { authUserId }, select: SELECT });
  if (existing) return { user: existing, created: false };

  try {
    const user = await db.$transaction(async (tx) => {
      const row = await tx.user.create({ data: { authUserId, role: "CANDIDATE" }, select: SELECT });
      await tx.auditEvent.create({
        data: {
          actorUserId: row.id,
          actorRole: "CANDIDATE",
          action: "USER_CREATED",
          targetType: "User",
          targetId: row.id,
          metadata: { source: "auth_sync", role: "CANDIDATE" },
        },
      });
      return row;
    });
    return { user, created: true };
  } catch (e) {
    // A concurrent request created the row first: use it, never create a duplicate.
    if (isUniqueViolation(e)) {
      const winner = await db.user.findUnique({ where: { authUserId }, select: SELECT });
      if (winner) return { user: winner, created: false };
    }
    throw e;
  }
}
