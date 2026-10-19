import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { artifacts, ethers, network } from "hardhat";

// Contract tests for FarjiRegistry (BLOCKCHAIN_MODEL §14). Run with `npm run test:contracts`.
// Golden vectors come from tests/vectors/crypto.json (the TypeScript implementation is authoritative).

/* eslint-disable @typescript-eslint/no-explicit-any */
const vectors = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "tests", "vectors", "crypto.json"), "utf8"));

const rep = (byte: string) => "0x" + byte.repeat(32);
const ZERO = "0x" + "00".repeat(32);
const ORG_A = rep("11"); // the golden vectors' organisation
const ORG_B = rep("12");
const COHORT = 0;
const PULSE = 1;
const ACTIVE = 1;
const SUSPENDED = 2;
const abi = ethers.AbiCoder.defaultAbiCoder();

const chainRootOf = (batchRoot: string, previous: string, org: string, type: number, epoch: bigint | number) =>
  ethers.keccak256(abi.encode(["bytes32", "bytes32", "bytes32", "uint8", "uint64"], [batchRoot, previous, org, type, epoch]));

const registryInterface = new ethers.Interface(artifacts.readArtifactSync("FarjiRegistry").abi);

/**
 * The custom error of a failed call/transaction. The Hardhat provider reports it as a message
 * ("reverted with custom error 'Name(args)'"); the raw revert data is decoded through the ABI when present.
 */
function decodeRevert(e: any): { name: string; args: unknown[] } | null {
  const data: unknown = e?.data ?? e?.error?.data ?? e?.info?.error?.data;
  if (typeof data === "string" && data.length >= 10) {
    const parsed = registryInterface.parseError(data);
    if (parsed) return { name: parsed.name, args: [...parsed.args] };
  }
  const m = /custom error '([A-Za-z0-9_]+)\(/.exec(String(e?.message ?? e?.shortMessage ?? ""));
  return m ? { name: m[1], args: [] } : null;
}

async function reverts(p: Promise<unknown>, name: string, args?: unknown[]) {
  try {
    await p;
  } catch (e: any) {
    const d = decodeRevert(e);
    const got = d?.name ?? `(no custom error) ${String(e?.shortMessage ?? e?.message).slice(0, 160)}`;
    assert.equal(got, name, `expected revert ${name}, got ${got}`);
    if (args && d && d.args.length) {
      const norm = (a: unknown) => (typeof a === "bigint" ? a : String(a).toLowerCase());
      assert.deepEqual(d.args.map(norm), args.map(norm));
    }
    return;
  }
  assert.fail(`expected revert ${name} but the call succeeded`);
}

async function mine(seconds = 1) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
}

const blockTime = async (receipt: any): Promise<bigint> => BigInt((await receipt.getBlock()).timestamp);

function eventOf(registry: any, receipt: any, name: string) {
  const parsed = receipt.logs
    .map((l: any) => {
      try {
        return registry.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .filter((x: any) => x && x.name === name);
  assert.equal(parsed.length, 1, `expected exactly one ${name} event`);
  return parsed[0];
}

const tx = async (p: Promise<any>) => {
  const sent = await p;
  return sent.wait();
};

describe("FarjiRegistry", () => {
  let registry: any;
  let defaultAdmin: any, platformAdmin: any, issuerA: any, issuerB: any, stranger: any, issuerA2: any, issuerA3: any;

  const as = (signer: any) => registry.connect(signer);

  beforeEach(async () => {
    [defaultAdmin, platformAdmin, issuerA, issuerB, stranger, issuerA2, issuerA3] = await ethers.getSigners();
    registry = await ethers.deployContract("FarjiRegistry", [0, defaultAdmin.address, platformAdmin.address]);
    await registry.waitForDeployment();
  });

  /** Registers ORG_A and ORG_B and authorises issuerA (for A) and issuerB (for B). */
  async function setup() {
    await tx(as(platformAdmin).registerOrganisation(ORG_A, rep("a1")));
    await tx(as(platformAdmin).registerOrganisation(ORG_B, rep("b1")));
    await tx(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address));
    await tx(as(platformAdmin).authoriseIssuerWallet(ORG_B, issuerB.address));
    await mine(2);
  }

  const anchorCohort = (signer: any, org: string, root: string, leafCount: number, previous: string) =>
    as(signer).anchorCohortRoot(org, root, leafCount, vectors.schema.schemaId, previous);
  const anchorPulse = (signer: any, org: string, root: string, seq: number, leafCount: number, previous: string) =>
    as(signer).anchorProofPulseEpoch(org, root, seq, leafCount, previous);

  // ───────────────────────── deployment & roles ─────────────────────────

  describe("deployment and roles", () => {
    it("grants DEFAULT_ADMIN to the default admin and PLATFORM_ADMIN to the platform admin only", async () => {
      const PLATFORM = await registry.PLATFORM_ADMIN_ROLE();
      const DEFAULT = await registry.DEFAULT_ADMIN_ROLE();
      assert.equal(await registry.hasRole(DEFAULT, defaultAdmin.address), true);
      assert.equal(await registry.hasRole(PLATFORM, platformAdmin.address), true);
      assert.equal(await registry.hasRole(PLATFORM, defaultAdmin.address), false);
      assert.equal(await registry.hasRole(DEFAULT, platformAdmin.address), false);
      assert.equal(await registry.anchoringPaused(), false);
    });

    it("rejects a zero platform admin", async () => {
      const factory = await ethers.getContractFactory("FarjiRegistry");
      await reverts(factory.deploy(0, defaultAdmin.address, ethers.ZeroAddress), "ZeroAddress");
    });

    it("only the default admin grants the platform role", async () => {
      const PLATFORM = await registry.PLATFORM_ADMIN_ROLE();
      await reverts(as(stranger).grantRole(PLATFORM, stranger.address), "AccessControlUnauthorizedAccount");
      await reverts(as(platformAdmin).grantRole(PLATFORM, stranger.address), "AccessControlUnauthorizedAccount");
      await tx(as(defaultAdmin).grantRole(PLATFORM, stranger.address));
      assert.equal(await registry.hasRole(PLATFORM, stranger.address), true);
    });

    it("is non-upgradeable: no proxy, delegatecall or selfdestruct in the bytecode surface", async () => {
      const iface = registry.interface;
      for (const name of ["upgradeTo", "upgradeToAndCall", "initialize", "selfdestruct", "implementation"]) {
        assert.equal(iface.getFunction(name), null, `${name} must not exist`);
      }
    });
  });

  // ───────────────────────── organisations ─────────────────────────

  describe("organisations", () => {
    it("registers an organisation as ACTIVE and emits OrganisationRegistered", async () => {
      const receipt = await tx(as(platformAdmin).registerOrganisation(ORG_A, rep("a1")));
      const org = await registry.organisations(ORG_A);
      assert.equal(org.status, 1n);
      assert.equal(org.registeredAt, await blockTime(receipt));
      assert.equal(org.metadataHash, rep("a1"));
      const ev = eventOf(registry, receipt, "OrganisationRegistered");
      assert.equal(ev.args.orgId, ORG_A);
      assert.equal(ev.args.metadataHash, rep("a1"));
    });

    it("rejects a duplicate organisation", async () => {
      await tx(as(platformAdmin).registerOrganisation(ORG_A, rep("a1")));
      await reverts(as(platformAdmin).registerOrganisation(ORG_A, rep("a2")), "OrganisationAlreadyRegistered", [ORG_A]);
    });

    it("rejects unauthorised callers (strangers, issuers, even the default admin)", async () => {
      await setup();
      for (const s of [stranger, issuerA, defaultAdmin]) {
        await reverts(as(s).registerOrganisation(rep("33"), rep("a1")), "AccessControlUnauthorizedAccount");
        await reverts(as(s).setOrganisationStatus(ORG_A, SUSPENDED), "AccessControlUnauthorizedAccount");
      }
    });

    it("suspends and reactivates, emitting events and never touching history", async () => {
      await setup();
      const r1 = await tx(as(platformAdmin).setOrganisationStatus(ORG_A, SUSPENDED));
      assert.equal(eventOf(registry, r1, "OrganisationStatusChanged").args.status, 2n);
      assert.equal((await registry.organisations(ORG_A)).status, 2n);
      const r2 = await tx(as(platformAdmin).setOrganisationStatus(ORG_A, ACTIVE));
      assert.equal(eventOf(registry, r2, "OrganisationStatusChanged").args.status, 1n);
      assert.equal((await registry.getIssuerKey(issuerA.address)).orgId, ORG_A); // keys untouched
    });

    it("rejects unknown organisations, unchanged status and invalid status values", async () => {
      await setup();
      await reverts(as(platformAdmin).setOrganisationStatus(rep("44"), SUSPENDED), "OrganisationNotRegistered");
      await reverts(as(platformAdmin).setOrganisationStatus(ORG_A, ACTIVE), "StatusUnchanged");
      await reverts(as(platformAdmin).setOrganisationStatus(ORG_A, 0), "InvalidStatus");
    });
  });

  // ───────────────────────── issuer keys ─────────────────────────

  describe("issuer wallets", () => {
    beforeEach(async () => {
      await tx(as(platformAdmin).registerOrganisation(ORG_A, rep("a1")));
      await tx(as(platformAdmin).registerOrganisation(ORG_B, rep("b1")));
    });

    it("authorises a wallet for one organisation and records validFrom", async () => {
      const receipt = await tx(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address));
      const key = await registry.getIssuerKey(issuerA.address);
      assert.equal(key.orgId, ORG_A);
      assert.equal(key.validFrom, await blockTime(receipt));
      assert.equal(key.validUntil, 0n);
      assert.equal(key.compromisedAt, 0n);
      const ev = eventOf(registry, receipt, "IssuerWalletAuthorised");
      assert.equal(ev.args.orgId, ORG_A);
      assert.equal(ev.args.wallet, issuerA.address);
    });

    it("rejects a zero wallet, unknown or suspended organisations and non-admins", async () => {
      await reverts(as(platformAdmin).authoriseIssuerWallet(ORG_A, ethers.ZeroAddress), "ZeroAddress");
      await reverts(as(platformAdmin).authoriseIssuerWallet(rep("44"), issuerA.address), "OrganisationNotActive");
      await tx(as(platformAdmin).setOrganisationStatus(ORG_A, SUSPENDED));
      await reverts(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address), "OrganisationNotActive");
      await reverts(as(stranger).authoriseIssuerWallet(ORG_B, issuerB.address), "AccessControlUnauthorizedAccount");
      await reverts(as(issuerB).authoriseIssuerWallet(ORG_B, issuerB.address), "AccessControlUnauthorizedAccount");
    });

    it("a wallet already known is never authorised again - same or any other organisation", async () => {
      await tx(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address));
      await reverts(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address), "WalletAlreadyKnown");
      await reverts(as(platformAdmin).authoriseIssuerWallet(ORG_B, issuerA.address), "WalletAlreadyKnown"); // cannot be re-bound
      await mine(2);
      await tx(as(platformAdmin).retireIssuerWallet(issuerA.address));
      await reverts(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address), "WalletAlreadyKnown"); // retired: never again
      await reverts(as(platformAdmin).authoriseIssuerWallet(ORG_B, issuerA.address), "WalletAlreadyKnown");
    });

    it("a compromised wallet is never authorised again either", async () => {
      await tx(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address));
      await mine(2);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      await tx(as(platformAdmin).markIssuerWalletCompromised(issuerA.address, now));
      await reverts(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address), "WalletAlreadyKnown");
    });

    it("retires once, keeps the record and rejects a second retirement or an unknown wallet", async () => {
      const authorised = await tx(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address));
      await mine(5);
      const retired = await tx(as(platformAdmin).retireIssuerWallet(issuerA.address));
      const key = await registry.getIssuerKey(issuerA.address);
      assert.equal(key.orgId, ORG_A); // never deleted
      assert.equal(key.validFrom, await blockTime(authorised));
      assert.equal(key.validUntil, await blockTime(retired));
      assert.equal(eventOf(registry, retired, "IssuerWalletRetired").args.validUntil, key.validUntil);
      await reverts(as(platformAdmin).retireIssuerWallet(issuerA.address), "WalletNotOpen");
      await reverts(as(platformAdmin).retireIssuerWallet(stranger.address), "WalletUnknown");
      await reverts(as(stranger).retireIssuerWallet(issuerA.address), "AccessControlUnauthorizedAccount");
    });

    it("historical validity: authorised exactly in [validFrom, validUntil)", async () => {
      const a = await tx(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address));
      await mine(10);
      const r = await tx(as(platformAdmin).retireIssuerWallet(issuerA.address));
      const from = await blockTime(a);
      const until = await blockTime(r);
      const at = (t: bigint, org = ORG_A) => registry.isIssuerAuthorisedAt(org, issuerA.address, t);
      assert.equal(await at(from - 1n), false);
      assert.equal(await at(from), true);
      assert.equal(await at(until - 1n), true);
      assert.equal(await at(until), false); // retirement instant is exclusive
      assert.equal(await at(until + 1000n), false);
      assert.equal(await at(from + 1n, ORG_B), false); // wrong organisation
      assert.equal(await registry.isIssuerAuthorisedAt(ORG_A, stranger.address, from + 1n), false);
    });

    it("rotation retires the old wallet and authorises a FRESH one at the same timestamp", async () => {
      await tx(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address));
      await mine(5);
      const receipt = await tx(as(platformAdmin).rotateIssuerWallet(ORG_A, issuerA.address, issuerA2.address));
      const oldKey = await registry.getIssuerKey(issuerA.address);
      const newKey = await registry.getIssuerKey(issuerA2.address);
      assert.equal(oldKey.validUntil, newKey.validFrom);
      assert.equal(newKey.orgId, ORG_A);
      assert.equal(newKey.validUntil, 0n);
      eventOf(registry, receipt, "IssuerWalletRetired");
      eventOf(registry, receipt, "IssuerWalletAuthorised");
      const rotated = eventOf(registry, receipt, "IssuerWalletRotated");
      assert.equal(rotated.args.oldWallet, issuerA.address);
      assert.equal(rotated.args.newWallet, issuerA2.address);
    });

    it("rotation rejects a reused wallet, another organisation's wallet, an already retired wallet and non-admins", async () => {
      await tx(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address));
      await tx(as(platformAdmin).authoriseIssuerWallet(ORG_B, issuerB.address));
      await mine(5);
      await reverts(as(platformAdmin).rotateIssuerWallet(ORG_A, issuerA.address, issuerB.address), "WalletAlreadyKnown");
      await reverts(as(platformAdmin).rotateIssuerWallet(ORG_A, issuerA.address, issuerA.address), "WalletAlreadyKnown"); // cannot rotate onto itself
      await reverts(as(platformAdmin).rotateIssuerWallet(ORG_A, issuerB.address, issuerA2.address), "WalletBelongsToOtherOrganisation");
      await reverts(as(platformAdmin).rotateIssuerWallet(ORG_A, stranger.address, issuerA2.address), "WalletUnknown");
      await reverts(as(stranger).rotateIssuerWallet(ORG_A, issuerA.address, issuerA2.address), "AccessControlUnauthorizedAccount");
      await tx(as(platformAdmin).retireIssuerWallet(issuerA.address));
      await reverts(as(platformAdmin).rotateIssuerWallet(ORG_A, issuerA.address, issuerA3.address), "WalletNotOpen");
      // nothing leaked from the failed rotations
      assert.equal((await registry.getIssuerKey(issuerA3.address)).orgId, ZERO);
    });

    it("marks a wallet compromised once, bounds the time, closes validity and keeps history", async () => {
      const a = await tx(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address));
      const from = await blockTime(a);
      await mine(20);
      const latest = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
      await reverts(as(platformAdmin).markIssuerWalletCompromised(issuerA.address, from - 1n), "InvalidCompromiseTime");
      await reverts(as(platformAdmin).markIssuerWalletCompromised(issuerA.address, latest + 1000n), "InvalidCompromiseTime");
      await reverts(as(platformAdmin).markIssuerWalletCompromised(issuerA.address, 0), "InvalidCompromiseTime");
      await reverts(as(platformAdmin).markIssuerWalletCompromised(stranger.address, from), "WalletUnknown");
      await reverts(as(stranger).markIssuerWalletCompromised(issuerA.address, from + 1n), "AccessControlUnauthorizedAccount");

      const when = from + 5n;
      const receipt = await tx(as(platformAdmin).markIssuerWalletCompromised(issuerA.address, when));
      const key = await registry.getIssuerKey(issuerA.address);
      assert.equal(key.compromisedAt, when);
      assert.equal(key.validUntil, await blockTime(receipt)); // an open key is closed
      const ev = eventOf(registry, receipt, "IssuerWalletCompromised");
      assert.equal(ev.args.compromisedAt, when);
      await reverts(as(platformAdmin).markIssuerWalletCompromised(issuerA.address, when), "WalletNotOpen"); // once
      assert.equal(key.orgId, ORG_A); // additive: record retained
    });

    it("compromise can also be marked on a wallet that was already retired (validUntil is kept)", async () => {
      const a = await tx(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address));
      await mine(5);
      const r = await tx(as(platformAdmin).retireIssuerWallet(issuerA.address));
      await mine(5);
      await tx(as(platformAdmin).markIssuerWalletCompromised(issuerA.address, (await blockTime(a)) + 1n));
      const key = await registry.getIssuerKey(issuerA.address);
      assert.equal(key.validUntil, await blockTime(r));
      assert.notEqual(key.compromisedAt, 0n);
    });

    it("isEvidenceKeyValid: later retirement is harmless; evidence anchored at/after compromise is not valid", async () => {
      const a = await tx(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address));
      const from = await blockTime(a);
      await mine(30);
      const issuedAt = from + 10n;
      const compromisedAt = from + 20n;
      await tx(as(platformAdmin).markIssuerWalletCompromised(issuerA.address, compromisedAt));
      const valid = (issued: bigint, anchored: bigint) => registry.isEvidenceKeyValid(ORG_A, issuerA.address, issued, anchored);
      assert.equal(await valid(issuedAt, compromisedAt - 1n), true); // anchored before the compromise
      assert.equal(await valid(issuedAt, compromisedAt), false); // anchored at the compromise
      assert.equal(await valid(issuedAt, compromisedAt + 100n), false);
      assert.equal(await valid(from - 1n, from), false); // not yet authorised at issuance
      assert.equal(await registry.isEvidenceKeyValid(ORG_B, issuerA.address, issuedAt, from), false); // wrong organisation
    });

    it("admin and issuer authority never overlap", async () => {
      const PLATFORM = await registry.PLATFORM_ADMIN_ROLE();
      await reverts(as(platformAdmin).authoriseIssuerWallet(ORG_A, platformAdmin.address), "WalletIsAdmin");
      await reverts(as(platformAdmin).authoriseIssuerWallet(ORG_A, defaultAdmin.address), "WalletIsAdmin");
      await tx(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address));
      await reverts(as(defaultAdmin).grantRole(PLATFORM, issuerA.address), "WalletIsAdmin");
      assert.equal(await registry.hasRole(PLATFORM, issuerA.address), false);
    });

    it("pause blocks new authorisations and rotations but never retirement or compromise marking", async () => {
      await tx(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA.address));
      await mine(5);
      await tx(as(platformAdmin).pauseAnchoring());
      await reverts(as(platformAdmin).authoriseIssuerWallet(ORG_A, issuerA2.address), "AnchoringIsPaused");
      await reverts(as(platformAdmin).rotateIssuerWallet(ORG_A, issuerA.address, issuerA2.address), "AnchoringIsPaused");
      const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
      await tx(as(platformAdmin).markIssuerWalletCompromised(issuerA.address, now));
      assert.notEqual((await registry.getIssuerKey(issuerA.address)).compromisedAt, 0n);
      // ...and retirement of another wallet while paused (authorise it first, after unpausing)
      await tx(as(platformAdmin).unpauseAnchoring());
      await tx(as(platformAdmin).authoriseIssuerWallet(ORG_B, issuerB.address));
      await mine(5);
      await tx(as(platformAdmin).pauseAnchoring());
      await tx(as(platformAdmin).retireIssuerWallet(issuerB.address));
      assert.notEqual((await registry.getIssuerKey(issuerB.address)).validUntil, 0n);
    });
  });

  // ───────────────────────── anchoring ─────────────────────────

  describe("anchoring", () => {
    beforeEach(setup);

    it("anchors a COHORT root, appends it to the chain and emits CohortRootAnchored", async () => {
      const root = rep("22");
      const receipt = await tx(anchorCohort(issuerA, ORG_A, root, 3, ZERO));
      const chainRoot = chainRootOf(root, ZERO, ORG_A, COHORT, 1);
      const head = await registry.getChainHead(ORG_A, COHORT);
      assert.equal(head.chainRoot, chainRoot);
      assert.equal(head.epoch, 1n);
      const a = await registry.getAnchor(chainRoot);
      assert.equal(a.orgId, ORG_A);
      assert.equal(a.attestationType, 0n);
      assert.equal(a.batchRoot, root);
      assert.equal(a.previousChainRoot, ZERO);
      assert.equal(a.epoch, 1n);
      assert.equal(a.leafCount, 3n);
      assert.equal(a.schemaId, vectors.schema.schemaId);
      assert.equal(a.anchoredBy, issuerA.address);
      assert.equal(a.anchoredAt, await blockTime(receipt));
      assert.equal(await registry.chainRootAt(ORG_A, COHORT, 1), chainRoot);
      const ev = eventOf(registry, receipt, "CohortRootAnchored");
      assert.equal(ev.args.chainRoot, chainRoot);
      assert.equal(ev.args.orgId, ORG_A);
      assert.equal(ev.args.epoch, 1n);
      assert.equal(ev.args.batchRoot, root);
      assert.equal(ev.args.previousChainRoot, ZERO);
      assert.equal(ev.args.anchoredBy, issuerA.address);
    });

    it("anchors a PROOF_PULSE epoch with its root sequence", async () => {
      const root = rep("22");
      const receipt = await tx(anchorPulse(issuerA, ORG_A, root, 7, 4, ZERO));
      const chainRoot = chainRootOf(root, ZERO, ORG_A, PULSE, 1);
      const a = await registry.getAnchor(chainRoot);
      assert.equal(a.attestationType, 1n);
      assert.equal(a.rootSeq, 7n);
      assert.equal(a.leafCount, 4n);
      assert.equal(await registry.lastPulseRootSeq(ORG_A), 7n);
      const ev = eventOf(registry, receipt, "ProofPulseEpochAnchored");
      assert.equal(ev.args.rootSeq, 7n);
      assert.equal(ev.args.chainRoot, chainRoot);
    });

    it("COHORT and PROOF_PULSE are independent chains per organisation, and organisations are independent", async () => {
      await tx(anchorCohort(issuerA, ORG_A, rep("22"), 1, ZERO));
      await tx(anchorPulse(issuerA, ORG_A, rep("22"), 1, 1, ZERO)); // pulse chain still at genesis
      await tx(anchorCohort(issuerB, ORG_B, rep("22"), 1, ZERO)); // another organisation, own genesis
      const cohort = await registry.getChainHead(ORG_A, COHORT);
      const pulse = await registry.getChainHead(ORG_A, PULSE);
      const other = await registry.getChainHead(ORG_B, COHORT);
      assert.equal(cohort.epoch, 1n);
      assert.equal(pulse.epoch, 1n);
      assert.equal((await registry.getChainHead(ORG_B, PULSE)).epoch, 0n);
      assert.notEqual(cohort.chainRoot, pulse.chainRoot); // same batchRoot, different chains
      assert.notEqual(cohort.chainRoot, other.chainRoot); // same batchRoot, different organisations
    });

    it("epochs increase monotonically and link to the previous chainRoot; every historical anchor stays readable", async () => {
      const roots = [rep("21"), rep("22"), rep("23")];
      let previous = ZERO;
      const chainRoots: string[] = [];
      for (let i = 0; i < roots.length; i++) {
        await tx(anchorCohort(issuerA, ORG_A, roots[i], i + 1, previous));
        previous = chainRootOf(roots[i], previous, ORG_A, COHORT, i + 1);
        chainRoots.push(previous);
      }
      assert.equal((await registry.getChainHead(ORG_A, COHORT)).epoch, 3n);
      for (let i = 0; i < 3; i++) {
        assert.equal(await registry.chainRootAt(ORG_A, COHORT, i + 1), chainRoots[i]);
        const a = await registry.getAnchor(chainRoots[i]);
        assert.equal(a.epoch, BigInt(i + 1));
        assert.equal(a.batchRoot, roots[i]);
        assert.equal(a.previousChainRoot, i === 0 ? ZERO : chainRoots[i - 1]);
        assert.equal(a.leafCount, BigInt(i + 1));
      }
      assert.equal(await registry.chainRootAt(ORG_A, COHORT, 4), ZERO); // nothing beyond the head
    });

    it("rejects a stale or wrong expectedPreviousChainRoot and a duplicate epoch (no forks)", async () => {
      const first = await tx(anchorCohort(issuerA, ORG_A, rep("21"), 1, ZERO));
      void first;
      const head1 = chainRootOf(rep("21"), ZERO, ORG_A, COHORT, 1);
      await reverts(anchorCohort(issuerA, ORG_A, rep("22"), 1, ZERO), "StaleChainHead", [head1, ZERO]); // building on epoch 0 again
      await reverts(anchorCohort(issuerA, ORG_A, rep("22"), 1, rep("99")), "StaleChainHead");
      await tx(anchorCohort(issuerA, ORG_A, rep("22"), 1, head1));
      assert.equal((await registry.getChainHead(ORG_A, COHORT)).epoch, 2n); // the stale attempts changed nothing
    });

    it("anchoring the same root twice yields different chainRoots (the epoch is committed)", async () => {
      await tx(anchorCohort(issuerA, ORG_A, rep("21"), 1, ZERO));
      const head1 = (await registry.getChainHead(ORG_A, COHORT)).chainRoot;
      await tx(anchorCohort(issuerA, ORG_A, rep("21"), 1, head1));
      assert.notEqual((await registry.getChainHead(ORG_A, COHORT)).chainRoot, head1);
    });

    it("rejects zero roots and zero leaf counts", async () => {
      await reverts(anchorCohort(issuerA, ORG_A, ZERO, 1, ZERO), "ZeroRoot");
      await reverts(anchorCohort(issuerA, ORG_A, rep("21"), 0, ZERO), "ZeroLeafCount");
      await reverts(anchorPulse(issuerA, ORG_A, ZERO, 1, 1, ZERO), "ZeroRoot");
      await reverts(anchorPulse(issuerA, ORG_A, rep("21"), 1, 0, ZERO), "ZeroLeafCount");
    });

    it("only an OPEN issuer wallet of THIS organisation may anchor", async () => {
      // another organisation's wallet, admins, strangers
      await reverts(anchorCohort(issuerB, ORG_A, rep("21"), 1, ZERO), "NotOpenIssuerOf");
      await reverts(anchorPulse(issuerB, ORG_A, rep("21"), 1, 1, ZERO), "NotOpenIssuerOf");
      await reverts(anchorCohort(platformAdmin, ORG_A, rep("21"), 1, ZERO), "NotOpenIssuerOf");
      await reverts(anchorCohort(defaultAdmin, ORG_A, rep("21"), 1, ZERO), "NotOpenIssuerOf");
      await reverts(anchorCohort(stranger, ORG_A, rep("21"), 1, ZERO), "NotOpenIssuerOf");
      assert.equal((await registry.getChainHead(ORG_A, COHORT)).epoch, 0n);
    });

    it("a retired wallet cannot anchor; its earlier anchors stay", async () => {
      await tx(anchorCohort(issuerA, ORG_A, rep("21"), 1, ZERO));
      const head = (await registry.getChainHead(ORG_A, COHORT)).chainRoot;
      await tx(as(platformAdmin).retireIssuerWallet(issuerA.address));
      await reverts(anchorCohort(issuerA, ORG_A, rep("22"), 1, head), "NotOpenIssuerOf");
      assert.equal((await registry.getAnchor(head)).anchoredBy, issuerA.address);
    });

    it("a compromised wallet cannot anchor", async () => {
      const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
      await tx(as(platformAdmin).markIssuerWalletCompromised(issuerA.address, now - 1n));
      await reverts(anchorCohort(issuerA, ORG_A, rep("21"), 1, ZERO), "NotOpenIssuerOf");
    });

    it("a rotated-in wallet continues the same chain", async () => {
      await tx(anchorCohort(issuerA, ORG_A, rep("21"), 1, ZERO));
      const head = (await registry.getChainHead(ORG_A, COHORT)).chainRoot;
      await tx(as(platformAdmin).rotateIssuerWallet(ORG_A, issuerA.address, issuerA2.address));
      await reverts(anchorCohort(issuerA, ORG_A, rep("22"), 1, head), "NotOpenIssuerOf");
      await tx(anchorCohort(issuerA2, ORG_A, rep("22"), 1, head));
      assert.equal((await registry.getChainHead(ORG_A, COHORT)).epoch, 2n);
    });

    it("a suspended organisation cannot anchor; reactivation resumes the SAME chain", async () => {
      await tx(anchorCohort(issuerA, ORG_A, rep("21"), 1, ZERO));
      const head = (await registry.getChainHead(ORG_A, COHORT)).chainRoot;
      await tx(as(platformAdmin).setOrganisationStatus(ORG_A, SUSPENDED));
      await reverts(anchorCohort(issuerA, ORG_A, rep("22"), 1, head), "OrganisationNotActive");
      await reverts(anchorPulse(issuerA, ORG_A, rep("22"), 1, 1, ZERO), "OrganisationNotActive");
      await tx(as(platformAdmin).setOrganisationStatus(ORG_A, ACTIVE));
      await tx(anchorCohort(issuerA, ORG_A, rep("22"), 1, head));
      assert.equal((await registry.getChainHead(ORG_A, COHORT)).epoch, 2n);
    });

    it("pausing blocks anchoring until unpaused", async () => {
      await tx(as(platformAdmin).pauseAnchoring());
      assert.equal(await registry.anchoringPaused(), true);
      await reverts(anchorCohort(issuerA, ORG_A, rep("21"), 1, ZERO), "AnchoringIsPaused");
      await reverts(anchorPulse(issuerA, ORG_A, rep("21"), 1, 1, ZERO), "AnchoringIsPaused");
      await reverts(as(platformAdmin).pauseAnchoring(), "AnchoringIsPaused");
      await reverts(as(stranger).unpauseAnchoring(), "AccessControlUnauthorizedAccount");
      await tx(as(platformAdmin).unpauseAnchoring());
      await reverts(as(platformAdmin).unpauseAnchoring(), "AnchoringNotPaused");
      await tx(anchorCohort(issuerA, ORG_A, rep("21"), 1, ZERO));
    });

    it("ProofPulse rootSeq is monotonic; the same rootSeq may only re-affirm the same root", async () => {
      await tx(anchorPulse(issuerA, ORG_A, rep("31"), 5, 2, ZERO));
      let head = (await registry.getChainHead(ORG_A, PULSE)).chainRoot;
      await reverts(anchorPulse(issuerA, ORG_A, rep("32"), 4, 2, head), "PulseRootSeqTooLow", [4n, 5n]);
      await reverts(anchorPulse(issuerA, ORG_A, rep("32"), 0, 2, head), "PulseRootSeqTooLow");
      await reverts(anchorPulse(issuerA, ORG_A, rep("32"), 5, 2, head), "PulseRootMismatch");
      await tx(anchorPulse(issuerA, ORG_A, rep("31"), 5, 2, head)); // unchanged root: "still current"
      assert.equal((await registry.getChainHead(ORG_A, PULSE)).epoch, 2n);
      head = (await registry.getChainHead(ORG_A, PULSE)).chainRoot;
      await tx(anchorPulse(issuerA, ORG_A, rep("33"), 6, 3, head));
      assert.equal(await registry.lastPulseRootSeq(ORG_A), 6n);
      // organisations keep their own sequence
      await tx(anchorPulse(issuerB, ORG_B, rep("34"), 1, 1, ZERO));
    });

    it("unregistered organisations cannot anchor", async () => {
      await reverts(anchorCohort(issuerA, rep("44"), rep("21"), 1, ZERO), "OrganisationNotActive");
    });

    it("reports gas for the two anchor functions", async () => {
      const c = await tx(anchorCohort(issuerA, ORG_A, rep("21"), 1, ZERO));
      const p = await tx(anchorPulse(issuerA, ORG_A, rep("21"), 1, 1, ZERO));
      console.log(`      gas: anchorCohortRoot=${c.gasUsed} anchorProofPulseEpoch=${p.gasUsed}`);
      assert.ok(c.gasUsed < 300000n && p.gasUsed < 300000n);
    });
  });

  // ───────────────────────── revocation & ownership ─────────────────────────

  describe("revocation and credential ownership", () => {
    const SALT = rep("aa"); // the golden vector's credentialSalt

    beforeEach(setup);

    it("credentialId matches the TypeScript golden vector and embeds the organisation", async () => {
      assert.equal(await registry.computeCredentialId(ORG_A, SALT), vectors.credentialId);
      assert.notEqual(await registry.computeCredentialId(ORG_B, SALT), vectors.credentialId);
    });

    it("the issuing organisation revokes its own credential and the owner is recorded", async () => {
      const receipt = await tx(as(issuerA).revokeCredential(ORG_A, SALT, 2));
      const rev = await registry.getRevocation(vectors.credentialId);
      assert.equal(rev.orgId, ORG_A);
      assert.equal(rev.reasonCode, 2n);
      assert.equal(rev.revokedBy, issuerA.address);
      assert.equal(rev.revokedAt, await blockTime(receipt));
      const ev = eventOf(registry, receipt, "CredentialRevoked");
      assert.equal(ev.args.credentialId, vectors.credentialId);
      assert.equal(ev.args.orgId, ORG_A);
      assert.equal(ev.args.credentialSalt, SALT); // credentialSalt becomes public, by design
      console.log(`      gas: revokeCredential=${receipt.gasUsed}`);
    });

    it("another organisation's issuer can NOT revoke it: wrong orgId is rejected", async () => {
      await reverts(as(issuerB).revokeCredential(ORG_A, SALT, 1), "NotOpenIssuerOf");
      assert.equal((await registry.getRevocation(vectors.credentialId)).orgId, ZERO);
    });

    it("a foreign issuer revoking with ITS OWN orgId and the same salt revokes a DIFFERENT id", async () => {
      await tx(as(issuerB).revokeCredential(ORG_B, SALT, 1));
      const otherId = await registry.computeCredentialId(ORG_B, SALT);
      assert.notEqual(otherId, vectors.credentialId);
      assert.equal((await registry.getRevocation(otherId)).orgId, ORG_B);
      assert.equal((await registry.getRevocation(vectors.credentialId)).orgId, ZERO); // A's credential is untouched
    });

    it("an arbitrary authorised issuer, an admin or a stranger cannot revoke someone else's credential", async () => {
      for (const s of [issuerB, platformAdmin, defaultAdmin, stranger]) {
        await reverts(as(s).revokeCredential(ORG_A, SALT, 1), "NotOpenIssuerOf");
      }
    });

    it("there is no revoke-by-credentialId entry point", async () => {
      const fns = registry.interface.fragments.filter((f: any) => f.type === "function").map((f: any) => f.format("sighash"));
      const revokers = fns.filter((f: string) => /revoke/i.test(f) && !f.startsWith("revokeRole")); // revokeRole = OZ role admin
      assert.deepEqual(revokers, ["revokeCredential(bytes32,bytes32,uint16)"]);
    });

    it("rejects a duplicate revocation, invalid reasons and unregistered organisations", async () => {
      await tx(as(issuerA).revokeCredential(ORG_A, SALT, 1));
      await reverts(as(issuerA).revokeCredential(ORG_A, SALT, 3), "AlreadyRevoked", [vectors.credentialId]);
      await reverts(as(issuerA).revokeCredential(ORG_A, rep("ab"), 0), "InvalidReason");
      await reverts(as(issuerA).revokeCredential(ORG_A, rep("ab"), 5), "InvalidReason");
      await reverts(as(issuerA).revokeCredential(rep("44"), SALT, 1), "OrganisationNotRegistered");
      for (const reason of [1, 2, 3, 4]) await tx(as(issuerA).revokeCredential(ORG_A, rep("c" + reason), reason));
    });

    it("an id in the caller's own namespace that was never issued can be 'revoked' harmlessly (existence is checked off-chain)", async () => {
      await tx(as(issuerA).revokeCredential(ORG_A, rep("ee"), 4));
      assert.equal((await registry.getRevocation(await registry.computeCredentialId(ORG_A, rep("ee")))).orgId, ORG_A);
    });

    it("a retired wallet cannot revoke; neither can a compromised one", async () => {
      await tx(as(platformAdmin).retireIssuerWallet(issuerA.address));
      await reverts(as(issuerA).revokeCredential(ORG_A, SALT, 1), "NotOpenIssuerOf");
      const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
      await tx(as(platformAdmin).markIssuerWalletCompromised(issuerB.address, now - 1n));
      await reverts(as(issuerB).revokeCredential(ORG_B, SALT, 1), "NotOpenIssuerOf");
    });

    it("revocation is allowed while the organisation is suspended and while anchoring is paused", async () => {
      await tx(as(platformAdmin).setOrganisationStatus(ORG_A, SUSPENDED));
      await tx(as(platformAdmin).pauseAnchoring());
      await tx(as(issuerA).revokeCredential(ORG_A, SALT, 1));
      assert.equal((await registry.getRevocation(vectors.credentialId)).orgId, ORG_A);
    });

    it("revocation does not change anchors (nothing is deleted or rewritten)", async () => {
      await tx(anchorCohort(issuerA, ORG_A, rep("21"), 1, ZERO));
      const head = await registry.getChainHead(ORG_A, COHORT);
      await tx(as(issuerA).revokeCredential(ORG_A, SALT, 1));
      const after = await registry.getChainHead(ORG_A, COHORT);
      assert.equal(after.chainRoot, head.chainRoot);
      assert.equal((await registry.getAnchor(head.chainRoot)).batchRoot, rep("21"));
    });
  });

  // ───────────────────────── golden vectors ─────────────────────────

  describe("golden vectors (TypeScript is authoritative)", () => {
    beforeEach(setup);

    it("computeChainRoot reproduces the committed COHORT and PROOF_PULSE vectors", async () => {
      assert.equal(await registry.computeChainRoot(rep("22"), ZERO, ORG_A, COHORT, 1), vectors.chainRoot);
      assert.equal(await registry.computeChainRoot(rep("22"), ZERO, ORG_A, PULSE, 1), vectors.chainRootProofPulse);
    });

    it("real anchors at epoch 1 produce exactly the committed chainRoots", async () => {
      await tx(anchorCohort(issuerA, ORG_A, rep("22"), 1, ZERO));
      await tx(anchorPulse(issuerA, ORG_A, rep("22"), 1, 1, ZERO));
      assert.equal((await registry.getChainHead(ORG_A, COHORT)).chainRoot, vectors.chainRoot);
      assert.equal((await registry.getChainHead(ORG_A, PULSE)).chainRoot, vectors.chainRootProofPulse);
    });

    it("CohortProof leaves anchored on-chain verify with the committed proofs (OpenZeppelin MerkleProof compatible)", async () => {
      await tx(anchorCohort(issuerA, ORG_A, vectors.cohort.root, 3, ZERO));
      const chainRoot = (await registry.getChainHead(ORG_A, COHORT)).chainRoot;
      for (const entry of vectors.cohort.entries) {
        assert.equal(await registry.verifyCohortInclusion(chainRoot, entry.leafHash, entry.proof.siblings), true);
      }
      const e = vectors.cohort.entries[0];
      assert.equal(await registry.verifyCohortInclusion(chainRoot, rep("ee"), e.proof.siblings), false); // tampered leaf
      assert.equal(await registry.verifyCohortInclusion(chainRoot, e.leafHash, [rep("ee")]), false); // tampered proof
      assert.equal(await registry.verifyCohortInclusion(rep("ee"), e.leafHash, e.proof.siblings), false); // unknown anchor
      // a PROOF_PULSE anchor is not a CohortProof root
      await tx(anchorPulse(issuerA, ORG_A, vectors.cohort.root, 1, 3, ZERO));
      const pulseRoot = (await registry.getChainHead(ORG_A, PULSE)).chainRoot;
      assert.equal(await registry.verifyCohortInclusion(pulseRoot, e.leafHash, e.proof.siblings), false);
    });
  });
});

// ───────────────────────── Solidity vs TypeScript hash vectors ─────────────────────────

describe("VectorHarness: Solidity reproduces the TypeScript vectors", () => {
  let h: any;
  const validFrom = BigInt(Date.UTC(2022, 0, 10) / 1000);
  const issuedAt = 1760000000n;

  before(async () => {
    h = await ethers.deployContract("VectorHarness");
    await h.waitForDeployment();
  });

  it("tags equal keccak256 of the tag strings and the committed values", async () => {
    assert.equal(await h.COHORT_LEAF_V1(), vectors.tags.COHORT_LEAF_V1);
    assert.equal(await h.PULSE_LEAF_V1(), vectors.tags.PULSE_LEAF_V1);
    assert.equal(await h.PULSE_NODE_V1(), vectors.tags.PULSE_NODE_V1);
    assert.equal(await h.PULSE_EMPTY_V1(), vectors.tags.PULSE_EMPTY_V1);
    assert.equal(await h.SUBJECT_TAG(), vectors.tags.SUBJECT_TAG);
    assert.equal(await h.CREDENTIAL_ID_TAG(), vectors.tags.CREDENTIAL_ID_TAG);
  });

  it("credentialId, subjectCommitment and contentDigest match", async () => {
    assert.equal(await h.credentialId(rep("11"), rep("aa")), vectors.credentialId);
    assert.equal(await h.subjectCommitment("0x01990000000070008000000000000001", rep("cc")), vectors.subjectCommitment);
    const content = {
      category: 0,
      title: "Software Engineer",
      organisationName: "Acme Ltd",
      startDate: "2022-01-10",
      endDate: "2024-03-31",
      expiryDate: "",
      description: "",
      location: "",
      fieldOfStudy: "",
      credentialNumber: "",
      contentSalt: rep("bb"),
    };
    assert.equal(await h.contentDigest(content), vectors.contentDigest);
    assert.equal(await h.CONTENT_TYPEHASH(), vectors.schema.schemaId); // schemaId is the type hash
  });

  it("cohort leaf hashes match", async () => {
    for (const [i, b] of ["01", "02", "03"].entries()) {
      const leaf = await h.cohortLeaf(rep("11"), rep(b), vectors.subjectCommitment, vectors.contentDigest, 0, validFrom, 0, issuedAt, vectors.schema.schemaId);
      assert.equal(leaf, vectors.cohort.leafHashes[i]);
    }
  });

  it("ProofPulse zero hashes, leaves and roots match", async () => {
    for (let i = 0; i <= 3; i++) assert.equal(await h.pulseZero(i), vectors.pulse.zeroHashes[i]);
    const leafA = await h.pulseLeaf(rep("11"), 0, rep("a1"), vectors.subjectCommitment, vectors.contentDigest, 0, 0, validFrom, 1);
    const leafB = await h.pulseLeaf(rep("11"), 1, rep("b2"), vectors.subjectCommitment, vectors.contentDigest, 0, 0, validFrom, 1);
    const ended = await h.pulseLeaf(rep("11"), 0, rep("a1"), vectors.subjectCommitment, vectors.contentDigest, 0, 1, 1740000000n, 2);
    assert.equal(leafA, vectors.pulse.leafA);
    assert.equal(leafB, vectors.pulse.leafB);
    assert.equal(ended, vectors.pulse.leafAEnded);
    // root with only leaf A: all siblings are zero hashes
    assert.equal(await h.pulseRoot(0, leafA, vectors.pulse.zeroHashes.slice(0, 3)), vectors.pulse.rootAfterA);
    // leaf B's committed proof folds to the root after leaf A ended
    assert.equal(await h.pulseRoot(1, leafB, vectors.pulse.proofOfB), vectors.pulse.rootAfterEnd);
    assert.equal(await h.pulseNode(vectors.pulse.zeroHashes[0], vectors.pulse.zeroHashes[0]), vectors.pulse.nodeOfZeros);
  });
});
