import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getEip712Config } from "@/server/issuance/config";

const root = path.join(__dirname, "..", "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (name === "generated" || name === "node_modules" || name === ".next") return [];
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const code = (f: string) =>
  readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");

describe("no private keys in production code", () => {
  const production = ["lib", "server", "app", "components"].flatMap((d) => files(path.join(root, d)));

  it("lib/, server/, app/ and components/ never hold, generate or use a private key or wallet", () => {
    expect(production.length).toBeGreaterThan(20);
    for (const f of production) {
      const c = code(f);
      expect(c, path.relative(root, f)).not.toMatch(/privateKey|private_key|mnemonic|HDNodeWallet|new Wallet\(|Wallet\.createRandom|\.signTypedData\(|\.signMessage\(|\.signTransaction\(/i);
    }
  });

  it("contains no 32-byte hex literal that could be a private key", () => {
    for (const f of production) {
      expect(code(f), path.relative(root, f)).not.toMatch(/["'`]0x[0-9a-fA-F]{64}["'`]/);
    }
  });

  it("does not read a private key from the environment", () => {
    for (const f of production) {
      expect(code(f), path.relative(root, f)).not.toMatch(/process\.env\.\w*(PRIVATE|MNEMONIC|SECRET_KEY|SEED)\w*/i);
    }
  });

  it("the only signing-capable test fixture lives under tests/", () => {
    const fixture = readFileSync(path.join(root, "tests", "fixtures", "test-wallets.ts"), "utf8");
    expect(fixture).toMatch(/TEST-ONLY/);
    // The Hardhat development key is public knowledge and used nowhere outside tests/.
    for (const f of production) expect(readFileSync(f, "utf8")).not.toMatch(/ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80/);
  });
});

describe("EIP-712 configuration has no default", () => {
  it("is disabled until chain id and registry address are set", () => {
    expect(() => getEip712Config({})).toThrow(/FARJI_CHAIN_ID/);
    expect(() => getEip712Config({ FARJI_CHAIN_ID: "31337" })).toThrow(/FARJI_REGISTRY_ADDRESS/);
    expect(() => getEip712Config({ FARJI_CHAIN_ID: "0", FARJI_REGISTRY_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3" })).toThrow();
    expect(() => getEip712Config({ FARJI_CHAIN_ID: "abc", FARJI_REGISTRY_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3" })).toThrow();
    expect(() => getEip712Config({ FARJI_CHAIN_ID: "31337", FARJI_REGISTRY_ADDRESS: "0x1234" })).toThrow();
  });

  it("normalises a valid configuration to a lowercase address and a bigint chain id", () => {
    const c = getEip712Config({ FARJI_CHAIN_ID: "11155111", FARJI_REGISTRY_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3" });
    expect(c).toEqual({ chainId: 11155111n, verifyingContract: "0x5fbdb2315678afecb367f032d93f642f64180aa3" });
  });
});
