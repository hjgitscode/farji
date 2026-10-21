// `npm run env:check` validates the environment FARJI will run in (reads .env.local then .env, then the process environment).
// Prints variable NAMES and rules only; never a value. Exit code 1 if any error.
// Set FARJI_CHECK_MODE=development to check a local setup (local chains and http URLs allowed).
import * as path from "node:path";
import * as dotenv from "dotenv";
import { validateProductionEnv } from "../config/production-env";

for (const f of [".env.local", ".env"]) dotenv.config({ path: path.join(__dirname, "..", f), quiet: true });
const production = process.env.FARJI_CHECK_MODE !== "development";
const report = validateProductionEnv(process.env, { production });
for (const e of report.errors) console.error(`ERROR   ${e}`);
for (const w of report.warnings) console.warn(`warning ${w}`);
console.log(report.errors.length === 0 ? `\nenvironment OK (${report.warnings.length} warning(s))` : `\n${report.errors.length} error(s)`);
process.exit(report.errors.length === 0 ? 0 : 1);
