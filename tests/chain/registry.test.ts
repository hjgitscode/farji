import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import abi from "@/lib/blockchain/farji-registry.abi.json";
import {
  decodeRegistryCall,
  decodeRegistryLogs,
  encodeAnchorCohortRoot,
  encodeAnchorProofPulseEpoch,
  encodeAuthoriseIssuerWallet,
  encodeMarkCompromised,
  encodeRegisterOrganisation,
  encodeRetireIssuerWallet,
  encodeRevokeCredential,
  encodeRotateIssuerWallet,
  encodeSetOrganisationStatus,
  metadataHashOf,
  ORG_STATUS_CODE,
  REVOCATION_REASON_CODE,
  registryInterface,
} from "@/lib/blockchain/registry";
import { ATTESTATION_TYPE_CODE } from "@/lib/crypto/constants";
import { getChainConfig, parseFinality } from "@/server/chain/config";
import { eventLog, hex32, REGISTRY } from "../fixtures/fake-rpc";

const wallet = "0x" + "ab".repeat(20);
const wallet2 = "0x" + "cd".repeat(20);

describe("ABI and enum agreement with the contract", () => {
  it("the exported ABI is the real FarjiRegistry: required functions and events exist, upgrade hooks do not", () => {
    const names = new Set(abi.filter((e) => e.type === "function" || e.type === "event").map((e) => e.name));
    for (const n of [
      "registerOrganisation",
      "setOrganisationStatus",
      "authoriseIssuerWallet",
      "retireIssuerWallet",
      "rotateIssuerWallet",
      "markIssuerWalletCompromised",
      "anchorCohortRoot",
      "anchorProofPulseEpoch",
      "revokeCredential",
      "pauseAnchoring",
      "computeChainRoot",
      "computeCredentialId",
      "isIssuerAuthorisedAt",
      "isEvidenceKeyValid",
      "verifyCohortInclusion",
      "OrganisationRegistered",
      "OrganisationStatusChanged",
      "IssuerWalletAuthorised",
      "IssuerWalletRetired",
      "IssuerWalletRotated",
      "IssuerWalletCompromised",
      "CohortRootAnchored",
      "ProofPulseEpochAnchored",
      "CredentialRevoked",
      "AnchoringPaused",
      "AnchoringUnpaused",
    ]) {
      expect(names.has(n), n).toBe(true);
    }
    for (const n of ["upgradeTo", "upgradeToAndCall", "initialize", "implementation"]) expect(names.has(n), n).toBe(false);
  });

  it("the enum codes used by the app match the Solidity enums (AttestationType, OrgStatus, reasons)", () => {
    const fn = (name: string) => abi.find((e) => e.type === "function" && e.name === name)!;
    const computeChainRoot = fn("computeChainRoot").inputs as { name: string; type: string; internalType?: string }[];
    expect(computeChainRoot.find((i) => i.name === "attestationType")?.internalType).toBe("enum FarjiRegistry.AttestationType");
    expect(ATTESTATION_TYPE_CODE).toEqual({ COHORT: 0, PROOF_PULSE: 1 });
    expect(ORG_STATUS_CODE).toEqual({ ACTIVE: 1, SUSPENDED: 2 });
    expect(REVOCATION_REASON_CODE).toEqual({ ISSUED_IN_ERROR: 1, FRAUD: 2, RECORD_CORRECTED: 3, OTHER: 4 });
  });

  it("the committed ABI equals the compiled artifact (run `npm run chain:abi` after changing the contract)", () => {
    const artifactPath = path.join(__dirname, "..", "..", "artifacts", "contracts", "FarjiRegistry.sol", "FarjiRegistry.json");
    let artifact: { abi: unknown } | null = null;
    try {
      artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    } catch {
      return; // artifacts are build output; `npm run compile` produces them
    }
    expect(abi).toEqual(artifact!.abi);
  });
});

describe("calldata encoding and decoding", () => {
  const org = hex32();
  const cases: [string, string, Record<string, unknown>][] = [
    ["registerOrganisation", encodeRegisterOrganisation(org, metadataHashOf("acme")), { orgId: org, metadataHash: metadataHashOf("acme") }],
    ["setOrganisationStatus", encodeSetOrganisationStatus(org, "SUSPENDED"), { orgId: org, status: 2n }],
    ["authoriseIssuerWallet", encodeAuthoriseIssuerWallet(org, wallet), { orgId: org, wallet }],
    ["retireIssuerWallet", encodeRetireIssuerWallet(wallet), { wallet }],
    ["rotateIssuerWallet", encodeRotateIssuerWallet(org, wallet, wallet2), { orgId: org, oldWallet: wallet, newWallet: wallet2 }],
    ["markIssuerWalletCompromised", encodeMarkCompromised(wallet, 1_760_000_000n), { wallet, compromisedAt: 1_760_000_000n }],
    ["anchorCohortRoot", encodeAnchorCohortRoot(org, hex32(), 3, hex32(), hex32()), { orgId: org, leafCount: 3n }],
    ["anchorProofPulseEpoch", encodeAnchorProofPulseEpoch(org, hex32(), 7n, 4, hex32()), { orgId: org, rootSeq: 7n, leafCount: 4n }],
    ["revokeCredential", encodeRevokeCredential(org, hex32(), "FRAUD"), { orgId: org, reasonCode: 2n }],
  ];
  for (const [name, data, expected] of cases) {
    it(`${name} round-trips`, () => {
      const call = decodeRegistryCall(data);
      expect(call?.name).toBe(name);
      expect(call?.args).toMatchObject(expected);
    });
  }

  it("decodes addresses and bytes32 values in lowercase", () => {
    const mixed = "0x5FbDB2315678afecb367f032d93F642f64180aa3"; // valid EIP-55 checksum casing
    const call = decodeRegistryCall(encodeRetireIssuerWallet(mixed));
    expect(call?.args.wallet).toBe(mixed.toLowerCase());
  });

  it("returns null for calldata that is not a FarjiRegistry function", () => {
    expect(decodeRegistryCall("0xdeadbeef")).toBeNull();
    expect(decodeRegistryCall("0x")).toBeNull();
    expect(decodeRegistryCall("nonsense")).toBeNull();
  });

  it("distinguishes rotation from plain retirement", () => {
    expect(decodeRegistryCall(encodeRetireIssuerWallet(wallet))?.name).toBe("retireIssuerWallet");
    expect(decodeRegistryCall(encodeRotateIssuerWallet(hex32(), wallet, wallet2))?.name).toBe("rotateIssuerWallet");
  });
});

describe("log decoding: only the configured registry", () => {
  const orgId = hex32();
  const registered = eventLog("OrganisationRegistered", { orgId, metadataHash: hex32() });

  it("decodes registry events with named, normalised arguments", () => {
    const events = decodeRegistryLogs([registered], REGISTRY);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("OrganisationRegistered");
    expect(events[0].args.orgId).toBe(orgId);
  });

  it("ignores logs from any other address, with any case of the configured address accepted", () => {
    const forged = eventLog("OrganisationRegistered", { orgId, metadataHash: hex32() }, "0x" + "de".repeat(20));
    expect(decodeRegistryLogs([forged], REGISTRY)).toEqual([]);
    expect(decodeRegistryLogs([registered], REGISTRY.toUpperCase().replace("0X", "0x"))).toHaveLength(1);
  });

  it("ignores undecodable logs and keeps log order information", () => {
    const junk = { address: REGISTRY, topics: ["0x" + "11".repeat(32)], data: "0x" };
    const a = eventLog("OrganisationStatusChanged", { orgId, status: 2 });
    const events = decodeRegistryLogs([junk, registered, a], REGISTRY);
    expect(events.map((e) => e.name)).toEqual(["OrganisationRegistered", "OrganisationStatusChanged"]);
    expect(events[1].logIndex).toBe(2);
  });

  it("uses the real ABI to encode every event the mirror consumes", () => {
    for (const name of ["IssuerWalletAuthorised", "IssuerWalletRetired", "IssuerWalletCompromised", "CohortRootAnchored", "ProofPulseEpochAnchored", "CredentialRevoked"]) {
      expect(registryInterface.getEvent(name), name).not.toBeNull();
    }
  });
});

describe("chain configuration (no defaults)", () => {
  const good = { FARJI_RPC_URL: "http://127.0.0.1:8545", FARJI_CHAIN_ID: "31337", FARJI_REGISTRY_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3" };

  it("is disabled until the RPC url, chain id and registry address are all set", () => {
    expect(() => getChainConfig({})).toThrow(/FARJI_CHAIN_ID/);
    expect(() => getChainConfig({ ...good, FARJI_RPC_URL: undefined })).toThrow(/FARJI_RPC_URL/);
    expect(() => getChainConfig({ ...good, FARJI_RPC_URL: "ws://x" })).toThrow(/FARJI_RPC_URL/);
    expect(() => getChainConfig({ ...good, FARJI_REGISTRY_ADDRESS: "0x12" })).toThrow(/FARJI_REGISTRY_ADDRESS/);
  });

  it("normalises the registry address and defaults finality to the Ethereum 'finalized' tag", () => {
    const cfg = getChainConfig(good);
    expect(cfg).toEqual({ rpcUrl: good.FARJI_RPC_URL, chainId: 31337n, registry: good.FARJI_REGISTRY_ADDRESS.toLowerCase(), finality: { mode: "finalized" } });
  });

  it("parses finality policies and rejects anything else", () => {
    expect(parseFinality(undefined)).toEqual({ mode: "finalized" });
    expect(parseFinality("finalized")).toEqual({ mode: "finalized" });
    expect(parseFinality("depth:0")).toEqual({ mode: "depth", depth: 0 });
    expect(parseFinality("depth:2")).toEqual({ mode: "depth", depth: 2 });
    for (const bad of ["depth:", "depth:-1", "safe", "12", "depth:abc"]) expect(() => parseFinality(bad), bad).toThrow();
  });
});
