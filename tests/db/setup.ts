import "dotenv/config";

// Database tests run against a REAL PostgreSQL (Supabase). Every test runs inside a
// transaction that is always rolled back, so nothing is ever persisted.
if (!(process.env.DIRECT_URL ?? process.env.DATABASE_URL)) {
  throw new Error(
    "Database tests need a real PostgreSQL. Set DATABASE_URL (and DIRECT_URL) in .env, " +
      "apply the migration with `npm run db:migrate`, then run `npm run test:db`.",
  );
}
if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to run database tests with NODE_ENV=production");
}
