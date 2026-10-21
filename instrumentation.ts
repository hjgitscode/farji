// Runs once when a production server instance starts. It reports configuration problems by variable NAME only (never a value)
// so a mis-set environment is visible in the platform logs. It does not stop the server: every feature that depends on a
// missing or invalid setting already refuses to run (chain features off, verification "unavailable", sync 401/503).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { validateProductionEnv } = await import("./config/production-env");
  const report = validateProductionEnv(process.env);
  for (const problem of report.errors) console.error(`[farji:config] ERROR ${problem}`);
  for (const note of report.warnings) console.warn(`[farji:config] warning ${note}`);
  if (report.errors.length === 0) console.info("[farji:config] production configuration looks valid");
}
