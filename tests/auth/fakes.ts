import type { ActorDb } from "@/lib/auth/authorize";

type UserRow = {
  id: string;
  authUserId: string;
  role: "CANDIDATE" | "ISSUER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
};
type MemberRow = {
  id: string;
  userId: string;
  organisationId: string;
  status: "INVITED" | "ACTIVE" | "REMOVED";
  /** Status of the member's organisation; defaults to ACTIVE. */
  organisationStatus?: "PENDING_ONBOARDING" | "ACTIVE" | "SUSPENDED";
};

/** Small in-memory stand-in for the Prisma calls the auth layer uses. */
export function makeFakeDb(seed: { users?: UserRow[]; members?: MemberRow[] } = {}) {
  const users: UserRow[] = [...(seed.users ?? [])];
  const members: MemberRow[] = [...(seed.members ?? [])];
  const audits: Record<string, unknown>[] = [];
  const userCreates: Record<string, unknown>[] = [];
  let nextId = 1;
  /** Simulates another request inserting the same user between our read and our create. */
  const hooks = { beforeCreate: undefined as undefined | (() => void) };

  const userApi = {
    findUnique: async ({ where }: { where: { authUserId: string } }) =>
      users.find((u) => u.authUserId === where.authUserId) ?? null,
    create: async ({ data }: { data: { authUserId: string; role: UserRow["role"] } }) => {
      userCreates.push(data);
      hooks.beforeCreate?.();
      if (users.some((u) => u.authUserId === data.authUserId)) throw Object.assign(new Error("unique"), { code: "P2002" });
      const row: UserRow = { id: `user-${nextId++}`, authUserId: data.authUserId, role: data.role, status: "ACTIVE" };
      users.push(row);
      return row;
    },
  };
  const auditApi = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      audits.push(data);
      return data;
    },
  };

  const db = {
    user: userApi,
    auditEvent: auditApi,
    organisationMember: {
      findFirst: async ({ where }: { where: { userId: string; status: string } }) =>
      (() => {
        const m = members.find((x) => x.userId === where.userId && x.status === where.status);
        return m
          ? { id: m.id, organisationId: m.organisationId, organisation: { status: m.organisationStatus ?? "ACTIVE" } }
          : null;
      })(),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ user: userApi, auditEvent: auditApi }),
  } as unknown as ActorDb;

  return { db, users, members, audits, userCreates, hooks };
}
