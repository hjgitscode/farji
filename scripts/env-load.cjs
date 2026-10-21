// Loads .env.local then .env (first value wins). Nothing is printed.
const path = require("node:path");
const dotenv = require("dotenv");
for (const f of [".env.local", ".env"]) dotenv.config({ path: path.join(__dirname, "..", f), quiet: true });
