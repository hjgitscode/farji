import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

// Server-only Prisma client. Never import this from client components.
// Uses DATABASE_URL (Supabase pooled connection string). Created lazily so that
// importing this module (e.g. during `next build`) never requires a database.

const globalForDb = globalThis as unknown as { farjiDb?: PrismaClient };

export function createDbClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export function getDb(): PrismaClient {
  if (!globalForDb.farjiDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.farjiDb = createDbClient(url);
  }
  return globalForDb.farjiDb;
}
