export type AppEnv = {
  appUrl: string;
};

export class EnvValidationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid environment configuration: ${problems.join("; ")}`);
    this.name = "EnvValidationError";
    this.problems = problems;
  }
}

const DEFAULT_APP_URL = "http://localhost:3000";

const stripHost = (v: string | undefined) => (v ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");

/** Validates and returns typed environment configuration. Pure: takes the env as input. */
export function parseEnv(source: Record<string, string | undefined>): AppEnv {
  const problems: string[] = [];
  // In production the auth redirect must never silently become localhost: fall back to the explicit public URL, then the
  // platform's production host. (Local development keeps the localhost default.)
  const production = source.NODE_ENV === "production";
  const platform = stripHost(source.VERCEL_PROJECT_PRODUCTION_URL);
  const appUrl =
    source.NEXT_PUBLIC_APP_URL?.trim() ||
    (production ? source.FARJI_PUBLIC_URL?.trim() || (platform ? `https://${platform}` : "") : "") ||
    DEFAULT_APP_URL;

  try {
    const url = new URL(appUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      problems.push("NEXT_PUBLIC_APP_URL must be an http(s) URL");
    }
  } catch {
    problems.push("NEXT_PUBLIC_APP_URL must be a valid URL");
  }

  if (problems.length > 0) throw new EnvValidationError(problems);
  return { appUrl };
}

export function getEnv(): AppEnv {
  return parseEnv(process.env);
}
