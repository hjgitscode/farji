import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(__dirname, "..", "..");

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    return statSync(p).isDirectory() ? files(p, pattern) : pattern.test(name) ? [p] : [];
  });
}

const strip = (f: string) =>
  readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");

const rel = (f: string) => path.relative(root, f);

describe("private areas: every page and action is guarded server-side", () => {
  const adminPages = files(path.join(root, "app", "admin"), /^page\.tsx$/);
  const issuerPages = files(path.join(root, "app", "issuer"), /^page\.tsx$/);

  it("every admin page calls requireAdmin and every issuer page calls requireIssuer", () => {
    expect(adminPages.length).toBeGreaterThanOrEqual(4);
    expect(issuerPages.length).toBeGreaterThanOrEqual(8);
    for (const p of adminPages) expect(strip(p), rel(p)).toMatch(/await requireAdmin\(/);
    for (const p of issuerPages) expect(strip(p), rel(p)).toMatch(/await requireIssuer\(/);
  });

  for (const [file, guard] of [
    ["app/admin/actions.ts", "requireAdmin"],
    ["app/issuer/chain-actions.ts", "requireIssuer"],
  ] as const) {
    it(`every exported action in ${file} authenticates with ${guard} before doing anything`, () => {
      const code = strip(path.join(root, file));
      const exported = (code.match(/export async function \w+/g) ?? []).length;
      const guarded = (code.match(new RegExp(`await ${guard}\\(`, "g")) ?? []).length;
      expect(exported).toBeGreaterThan(5);
      expect(guarded).toBeGreaterThanOrEqual(exported);
    });
  }
});

describe("browser trust boundary: the browser never chooses authoritative values", () => {
  const forbiddenParams = /\b(organisationId|orgId|credentialId|credentialSalt|contentSalt|subjectSalt|contentDigest|batchRoot|rootSeq|leafCount|schemaId|chainRoot|memberId|userId|candidateId|calldata|expectedPreviousChainRoot|issuerKeyId)\b/;

  for (const file of ["app/admin/actions.ts", "app/issuer/chain-actions.ts"]) {
    it(`no Server Action parameter in ${file} carries an organisation, member, credential, salt, digest, root or sequence`, () => {
      const code = strip(path.join(root, file));
      const signatures = [...code.matchAll(/export async function (\w+)\(([^)]*)\)/g)];
      expect(signatures.length).toBeGreaterThan(5);
      for (const [, name, params] of signatures) expect(params, `${file}:${name}`).not.toMatch(forbiddenParams);
    });

    it(`${file} never reads such values from a form or from the request`, () => {
      const code = strip(path.join(root, file));
      expect(code).not.toMatch(/formData\.get\(\s*["'](organisationId|orgId|memberId|userId|candidateId|credentialSalt|root|status|role)["']/);
    });
  }

  it("the wallet components send only an account, a signature, a hash and echoed issuedAt/nonce/effectiveAt", () => {
    for (const f of files(path.join(root, "components", "wallet"), /\.(ts|tsx)$/)) {
      const code = strip(f);
      expect(code, rel(f)).not.toMatch(/privateKey|mnemonic|new Wallet\(|Wallet\.createRandom|\.signMessage\(/);
      expect(code, rel(f)).not.toMatch(/from ["']ethers["']/); // no ethers (and so no signer/key handling) in the browser
      expect(code, rel(f)).not.toMatch(/organisationId|credentialSalt|contentDigest|batchRoot|leafCount/);
    }
  });

  it("transactions are built from a server-returned payload; the browser forwards only to/data it was given", () => {
    const code = strip(path.join(root, "components", "wallet", "wallet.ts"));
    expect(code).toMatch(/eth_sendTransaction/);
    expect(code).toMatch(/params: \[\{ from: account, to: tx\.to, data: tx\.data \}\]/);
    expect(code).toMatch(/eth_signTypedData_v4/);
  });
});

describe("finalised evidence is written only by the mirror; transaction status only by chain sync", () => {
  const serverAndApp = [...files(path.join(root, "server"), /\.ts$/), ...files(path.join(root, "app"), /\.(ts|tsx)$/), ...files(path.join(root, "lib"), /\.ts$/)].filter((f) => !f.includes("generated"));

  it("Anchor, Revocation and IssuerKey rows are created only in server/chain/mirror.ts", () => {
    const writers = serverAndApp.filter((f) => /\.(anchor|revocation|issuerKey)\.(create|createMany|upsert)\(/.test(strip(f))).map(rel);
    expect(writers.map((w) => w.replaceAll("\\", "/"))).toEqual(["server/chain/mirror.ts"]);
  });

  it("IssuerKey rows are changed only by the mirror and by the wallet binding (operatorMemberId)", () => {
    const writers = serverAndApp.filter((f) => /\.issuerKey\.(update|updateMany)\(/.test(strip(f))).map((f) => rel(f).replaceAll("\\", "/")).sort();
    expect(writers).toEqual(["server/chain/mirror.ts", "server/issuance/wallet-binding.ts"]);
  });

  it("a BlockchainTransaction's status is changed only by server/chain/sync.ts (chain sync)", () => {
    const writers = serverAndApp.filter((f) => /\.blockchainTransaction\.(update|updateMany)\(/.test(strip(f))).map((f) => rel(f).replaceAll("\\", "/"));
    expect(writers).toEqual(["server/chain/sync.ts"]);
  });

  it("the mirror runs inside the FINALIZED transition, nowhere else", () => {
    const callers = serverAndApp.filter((f) => /mirrorFinalizedTransaction\(/.test(strip(f)) && !f.endsWith("mirror.ts")).map((f) => rel(f).replaceAll("\\", "/"));
    expect(callers).toEqual(["server/chain/sync.ts"]);
    const sync = strip(path.join(root, "server", "chain", "sync.ts"));
    // FINALIZED update and mirror share one transaction
    expect(sync).toMatch(/status: "FINALIZED", finalizedAt: now/);
    expect(sync).toMatch(/inTransaction\(db, async \(tx\) => \{[\s\S]*mirrorFinalizedTransaction\(tx/);
  });

  it("Credential ANCHORED is set only by the mirror, and only from QUEUED_FOR_ANCHOR", () => {
    const writers = serverAndApp.filter((f) => /pipelineStatus: "ANCHORED"/.test(strip(f))).map((f) => rel(f).replaceAll("\\", "/"));
    expect(writers).toEqual(["server/chain/mirror.ts"]);
    const mirror = strip(path.join(root, "server", "chain", "mirror.ts"));
    expect(mirror.match(/pipelineStatus: "QUEUED_FOR_ANCHOR"/g)?.length).toBe(2);
  });

  it("no server code holds a private key, signs, or sends a transaction", () => {
    for (const f of serverAndApp) {
      expect(strip(f), rel(f)).not.toMatch(/\.sendTransaction\(|\.signTransaction\(|\.signTypedData\(|\.signMessage\(|new Wallet\(|privateKey|mnemonic/);
    }
  });

  it("the sync route is guarded by a shared secret and refuses when none is configured", () => {
    const code = strip(path.join(root, "app", "api", "chain", "sync", "route.ts"));
    expect(code).toMatch(/FARJI_SYNC_TOKEN/);
    expect(code).toMatch(/timingSafeEqual/);
    expect(code).toMatch(/return false; \/\/ not configured/);
  });

  it("the contract tooling does not turn the app into an ES module", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.type).toBeUndefined();
    expect(pkg.devDependencies.hardhat).toMatch(/^2\.26\./);
  });
});
