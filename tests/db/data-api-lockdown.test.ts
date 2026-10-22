import { describe, expect, it } from "vitest";
import { db } from "./helpers";

// Phase 16 (docs/PHASE16_SECURITY.md S-01): FARJI never uses the Supabase Data API, so the public `anon` / `authenticated`
// roles must hold no privilege on any table or sequence in `public`, and every table - including Prisma's own
// `_prisma_migrations` - has row level security enabled. Read-only catalogue checks.

describe("Supabase Data API lock-down", () => {
  it("every table in public has RLS enabled, including _prisma_migrations", async () => {
    const rows = await db.$queryRaw<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(rows.map((r) => r.relname)).toEqual([]);
    const prisma = await db.$queryRaw<{ rls: boolean }[]>`select relrowsecurity as rls from pg_class where relname = '_prisma_migrations'`;
    expect(prisma[0]?.rls).toBe(true);
  });

  it("anon and authenticated hold no table or sequence privilege in public", async () => {
    const roles = await db.$queryRaw<{ rolname: string }[]>`select rolname from pg_roles where rolname in ('anon', 'authenticated')`;
    if (roles.length === 0) return; // plain PostgreSQL without Supabase roles: nothing to check
    const tables = await db.$queryRaw<{ n: bigint }[]>`
      select count(*) as n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')`;
    expect(Number(tables[0].n)).toBe(0);
    const sequences = await db.$queryRaw<{ n: bigint }[]>`
      select count(*) as n from information_schema.role_usage_grants where object_schema = 'public' and grantee in ('anon', 'authenticated')`;
    expect(Number(sequences[0].n)).toBe(0);
  });

  it("tables created later by the owner are not granted to anon or authenticated by default", async () => {
    const rows = await db.$queryRaw<{ acl: string | null }[]>`
      select array_to_string(d.defaclacl, ',') as acl from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
      where n.nspname = 'public' and pg_get_userbyid(d.defaclrole) = 'postgres' and d.defaclobjtype in ('r', 'S')`;
    for (const r of rows) expect(r.acl ?? "").not.toMatch(/(^|,)(anon|authenticated)=/);
  });
});
