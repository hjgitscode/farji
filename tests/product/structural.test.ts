import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Structural guarantees of the Phase 11-13 product layer: import is not verification, public surfaces leak nothing private,
// every private page is guarded on the server, and the role areas do not cross over.

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Source without comments, so documentation prose cannot trip the checks. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}
const pagesUnder = (dir: string) => walk(dir).filter((f) => /\/page\.tsx$/.test(f));

describe("professional-profile import is not verification", () => {
  it("reuses the Phase 4 claim service and creates no credential, attestation, anchor, key, revocation or organisation", () => {
    const src = code("server/candidate/import.ts");
    expect(src).toMatch(/createClaim\(/);
    expect(src).not.toMatch(/\.(credential|attestation|anchor|issuerKey|revocation|cohortBatch|cohortLeaf|proofPulse\w*)\./);
    expect(src).not.toMatch(/organisation\.(create|update|upsert)/);
    expect(src).not.toMatch(/claim\.(create|createMany|update|updateMany|upsert)\(/); // claims are created only through createClaim
    expect(src).not.toMatch(/claimVersion\./);
    expect(src).not.toMatch(/pipelineStatus|visibility/); // imported records stay PRIVATE (the schema default)
  });

  it("the parser is pure and the importer makes no network call", () => {
    for (const f of walk("lib/import")) {
      const src = code(f);
      expect(src, f).not.toMatch(/Date\.now|new Date\(\s*\)|Math\.random|process\.env|\bfetch\s*\(|@\/lib\/database|@\/server|node:/);
    }
    for (const f of ["server/candidate/import.ts", "components/candidate/ImportWorkbench.tsx", "app/candidate/import/page.tsx"]) {
      expect(code(f), f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|axios|puppeteer|playwright|cheerio/);
    }
  });

  it("there is no LinkedIn scraping, login automation, OAuth or API credential anywhere", () => {
    const files = ["app", "components", "lib", "server"].flatMap((d) => walk(d)).filter((f) => !f.includes("generated"));
    for (const f of files) {
      const src = code(f);
      expect(src, f).not.toMatch(/api\.linkedin\.com|linkedin\.com\/(oauth|v2|uas)|LINKEDIN_|linkedin[_-]?(client|secret|token)/i);
    }
    const env = existsSync(join(root, ".env.example")) ? read(".env.example") : "";
    expect(env).not.toMatch(/LINKEDIN/i);
  });

  it("the import actions read an allowlisted payload, call the candidate guard first and take no identity from the client", () => {
    const src = code("app/candidate/actions.ts");
    for (const fn of ["saveProfileAction", "setVisibilityAction", "previewImportAction", "confirmImportAction"]) {
      const body = src.slice(src.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 220), fn).toMatch(/requireCandidate\(/);
    }
    expect(src).not.toMatch(/formData\.get\(["'](userId|candidateId|role|authUserId)["']\)/);
    expect(src).not.toMatch(/text\(formData, ["'](userId|candidateId|role|authUserId)["']\)/);
  });
});

describe("public surfaces leak nothing private", () => {
  const publicFiles = [...walk("app/(public)"), ...walk("server/public"), "components/public/PublicRecordCard.tsx", "components/public/EvidenceDetails.tsx", "lib/verification/bundle.ts"];

  it("never reference salts, signing nonces, reviewer notes, source references, workflow status or auth identity", () => {
    for (const f of publicFiles) {
      const src = code(f);
      expect(src, f).not.toMatch(/contentSalt|subjectSalt|credentialSalt|reviewDecision|sourceOfTruth|institutionalIdentifier|candidateNote|authUserId|pipelineStatus|\bnonce\b|\bnotes\b/);
    }
  });

  it("run without any private session: no guard, no cookies, no service-role key", () => {
    for (const f of [...walk("app/(public)"), ...walk("server/public")]) {
      const src = code(f);
      expect(src, f).not.toMatch(/requireCandidate|requireIssuer|requireAdmin|requireAuthenticatedUser|cookies\(|SERVICE_ROLE|createSupabase/);
    }
  });

  it("offer no bulk listing or search of people or credentials", () => {
    const src = code("server/public/read.ts");
    expect(src).not.toMatch(/profile\.findMany|credential\.findMany|user\.findMany|\bcontains\b|\bstartsWith\b/);
    expect(src).not.toMatch(/organisation\.findMany/);
    const routes = walk("app/(public)").filter((f) => /(page|route)\.tsx?$/.test(f)).map((f) => relative("app/(public)", f.replace(/\\/g, "/")));
    // every dynamic public route takes a specific identifier; there is no index of /p
    expect(routes.some((r) => /^p\/page\.tsx$/.test(r))).toBe(false);
    expect(existsSync(join(root, "app/(public)/p/page.tsx"))).toBe(false);
    expect(readdirSync(join(root, "app/api")).sort()).toEqual(["chain", "health"]);
  });

  it("public pages and cards carry no technical terms outside the verification-details panel", () => {
    for (const f of ["app/(public)/p/[handle]/page.tsx", "components/public/PublicRecordCard.tsx", "app/(public)/page.tsx", "app/(public)/verify/page.tsx"]) {
      expect(code(f), f).not.toMatch(/merkle|eip-?712|keccak|smart contract|\bhash\b|calldata|typed data/i);
    }
    for (const f of walk("app/candidate").filter((x) => /page\.tsx$/.test(x)).concat(["components/candidate/RecordCard.tsx", "components/candidate/VerificationStatus.tsx"])) {
      expect(code(f), f).not.toMatch(/merkle|eip-?712|keccak|smart contract|calldata/i);
    }
  });

  it("there are no developer, technology, novelty, explorer or demo pages", () => {
    const dirs = walk("app").map((f) => f.toLowerCase());
    for (const d of dirs) expect(d).not.toMatch(/\/(developers?|technology|novelty|explorer|contract-explorer|demo|how-it-works-technical|playground)\//);
    for (const f of [...walk("app"), ...walk("components")]) {
      expect(code(f), f).not.toMatch(/proof of concept|hackathon|for demo purposes|demo mode|fake data/i);
    }
  });

  it("visibility defaults are conservative in the schema", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toMatch(/model Profile \{[\s\S]*?visibility\s+ProfileVisibility\s+@default\(PRIVATE\)/);
    expect(schema).toMatch(/model Claim \{[\s\S]*?visibility\s+ProfileVisibility\s+@default\(PRIVATE\)/);
  });
});

describe("private pages are guarded on the server and the areas do not cross over", () => {
  it("every candidate, issuer and admin page calls its own guard", () => {
    for (const [dir, guard] of [["app/candidate", "requireCandidate"], ["app/issuer", "requireIssuer"], ["app/admin", "requireAdmin"]] as const) {
      const pages = pagesUnder(dir);
      expect(pages.length).toBeGreaterThan(3);
      for (const f of pages) expect(code(f), f).toContain(`${guard}(`);
      expect(code(`${dir}/layout.tsx`)).toContain(`${guard}(`);
    }
  });

  it("issuer pages use no admin action and admin pages no issuer action", () => {
    for (const f of walk("app/issuer")) expect(code(f), f).not.toMatch(/@\/app\/admin|requireAdmin|buildAdminTxAction/);
    for (const f of walk("app/admin")) expect(code(f), f).not.toMatch(/@\/app\/issuer|requireIssuer|prepareSigningAction|buildIssuerTxAction/);
    for (const f of walk("app/candidate")) expect(code(f), f).not.toMatch(/@\/app\/(admin|issuer)|requireIssuer|requireAdmin/);
  });

  it("ending a relationship uses the signed status change and never the revocation path", () => {
    const pulse = code("app/issuer/pulse/page.tsx");
    expect(pulse).toMatch(/prepareEndAction/);
    expect(pulse).toMatch(/acceptEndAction/);
    expect(pulse).not.toMatch(/REVOKE_CREDENTIAL|Revoke/);
    const creds = code("app/issuer/credentials/page.tsx");
    expect(creds).toMatch(/REVOKE_CREDENTIAL/);
    expect(creds).toMatch(/confirm=\{/); // revocation always asks for confirmation
    expect(creds).toMatch(/prepareSigningAction/); // signing uses the Phase 6 prepare/accept flow
    const cohort = code("app/issuer/cohort/page.tsx");
    expect(cohort).toMatch(/ANCHOR_COHORT/);
    expect(cohort).not.toMatch(/REVOKE_CREDENTIAL/);
  });

  it("the issuer inbox, history and credential lists are scoped by the actor's organisation, never by input", () => {
    const src = code("server/verification/records.ts");
    expect(src).toMatch(/organisationId: actor\.organisationId/);
    for (const f of ["app/issuer/history/page.tsx", "app/issuer/requests/page.tsx", "app/issuer/credentials/page.tsx"]) {
      expect(code(f), f).not.toMatch(/searchParams[\s\S]{0,80}organisation/i);
    }
  });

  it("issuer pages never show the private salts or raw typed data (signing details are plain facts)", () => {
    for (const f of pagesUnder("app/issuer")) expect(code(f), f).not.toMatch(/contentSalt|subjectSalt|credentialSalt|typedData|walletTypedData/);
  });
});
