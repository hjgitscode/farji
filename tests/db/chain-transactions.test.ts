import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/auth/authorize";
import { decodeRegistryCall, encodeRegisterOrganisation, encodeRevokeCredential, metadataHashOf, registryInterface } from "@/lib/blockchain/registry";
import { SCHEMA_ID, ZERO_HASH } from "@/lib/crypto/constants";
import type { TxPurpose } from "@/lib/database/generated/client";
import type { ChainConfig } from "@/server/chain/config";
import { buildTransaction, recordSubmittedTransaction } from "@/server/chain/transactions";
import { sealCohortBatch } from "@/server/merkle/cohort";
import { freshWallet } from "../fixtures/test-wallets";
import { FakeReader, FakeRpc, REGISTRY, hex32 } from "../fixtures/fake-rpc";
import { db, inRollback, mkMember, mkOrg, mkFinalizedTx, mkUser, type Tx } from "./helpers";
import { addKey, approvedCredential, CONTINUING, issuerOf, PERMANENT, signCredential, SIGN_NOW } from "./issuance-helpers";

afterAll(async () => {
  await db.$disconnect();
});

const NOW = new Date("2026-10-21T10:00:00Z");
const DAY = 24 * 3600 * 1000;
const caught = (p: Promise<unknown>) => p.then(() => null, (e) => e);

const cfg: ChainConfig = { rpcUrl: "http://fake", chainId: 31337n, registry: REGISTRY, finality: { mode: "depth", depth: 2 } };
const adminActor = async (tx: Tx): Promise<Actor> => ({ userId: (await mkUser(tx, "ADMIN")).id, authUserId: randomUUID(), role: "ADMIN", organisationId: null, organisationStatus: null, memberId: null });
const fast = { now: NOW, attempts: 1, delayMs: 0 };

/** Builds, then "broadcasts" to the fake node exactly what the server built (or a tampered version). */
async function buildAndBroadcast(tx: Tx, env: { rpc: FakeRpc; reader: FakeReader }, actor: Actor, purpose: TxPurpose, targetId: string, params: Parameters<typeof buildTransaction>[5], from: string, nonce = 0) {
  const built = await buildTransaction(tx, { cfg, reader: env.reader }, actor, purpose, targetId, params, { now: NOW });
  const sent = env.rpc.addTx({ from, nonce, data: built.data });
  return { built, sent };
}

describe("admin transactions: build and record", () => {
  async function setup(tx: Tx) {
    const admin = await adminActor(tx);
    const rpc = new FakeRpc();
    const reader = new FakeReader();
    const adminWallet = freshWallet().address.toLowerCase();
    reader.admins.add(adminWallet);
    return { admin, rpc, reader, adminWallet, org: await mkOrg(tx, "PENDING_ONBOARDING") };
  }

  it("builds registerOrganisation from the database (orgId, slug hash) and records the broadcast transaction", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const { built, sent } = await buildAndBroadcast(tx, s, s.admin, "REGISTER_ORGANISATION", s.org.id, {}, s.adminWallet, 5);
      const recorded = await recordSubmittedTransaction(tx, { cfg, rpc: s.rpc, reader: s.reader }, s.admin, { purpose: "REGISTER_ORGANISATION", targetId: s.org.id, txHash: sent.hash }, fast);
      return { s, built, sent, recorded, row: await tx.blockchainTransaction.findUniqueOrThrow({ where: { id: recorded.id } }) };
    });
    const call = decodeRegistryCall(r.built.data)!;
    expect(call.name).toBe("registerOrganisation");
    expect(call.args.orgId).toBe(r.s.org.orgId);
    expect(call.args.metadataHash).toBe(metadataHashOf(r.s.org.slug));
    expect(r.built).toMatchObject({ to: REGISTRY, chainId: "31337", targetType: "ORGANISATION", targetId: r.s.org.id });
    expect(r.recorded).toMatchObject({ status: "PENDING", alreadyRecorded: false });
    expect(r.row).toMatchObject({ purpose: "REGISTER_ORGANISATION", fromAddress: r.s.adminWallet, txNonce: 5n, chainId: 31337, initiatedByUserId: r.s.admin.userId, organisationId: r.s.org.id, status: "PENDING" });
  });

  it("recording the same hash twice returns the same row; another role cannot see it", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const { sent } = await buildAndBroadcast(tx, s, s.admin, "REGISTER_ORGANISATION", s.org.id, {}, s.adminWallet);
      const a = await recordSubmittedTransaction(tx, { cfg, rpc: s.rpc, reader: s.reader }, s.admin, { purpose: "REGISTER_ORGANISATION", targetId: s.org.id, txHash: sent.hash }, fast);
      const b = await recordSubmittedTransaction(tx, { cfg, rpc: s.rpc, reader: s.reader }, s.admin, { purpose: "REGISTER_ORGANISATION", targetId: s.org.id, txHash: sent.hash.toUpperCase().replace("0X", "0x") }, fast);
      return { a, b, count: await tx.blockchainTransaction.count({ where: { txHash: sent.hash.toLowerCase() } }) };
    });
    expect(r.b).toEqual({ ...r.a, alreadyRecorded: true });
    expect(r.count).toBe(1);
  });

  it("only one in-flight transaction per target and purpose; a FAILED one can be retried", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const { sent } = await buildAndBroadcast(tx, s, s.admin, "REGISTER_ORGANISATION", s.org.id, {}, s.adminWallet);
      const rec = await recordSubmittedTransaction(tx, { cfg, rpc: s.rpc, reader: s.reader }, s.admin, { purpose: "REGISTER_ORGANISATION", targetId: s.org.id, txHash: sent.hash }, fast);
      const dup = await caught(buildTransaction(tx, { cfg, reader: s.reader }, s.admin, "REGISTER_ORGANISATION", s.org.id, {}, { now: NOW }));
      await tx.blockchainTransaction.update({ where: { id: rec.id }, data: { status: "FAILED", failureReason: "reverted" } });
      const retry = await buildTransaction(tx, { cfg, reader: s.reader }, s.admin, "REGISTER_ORGANISATION", s.org.id, {}, { now: NOW });
      return { dup, retry };
    });
    expect(r.dup).toMatchObject({ code: "CONFLICT" });
    expect(r.retry.data).toMatch(/^0x/);
  });

  it("rejects: the wrong chain, the wrong contract, non-registry calldata, a different organisation's calldata, and an unknown hash", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const env = { cfg, rpc: s.rpc, reader: s.reader };
      const record = (hash: string) => caught(recordSubmittedTransaction(tx, env, s.admin, { purpose: "REGISTER_ORGANISATION", targetId: s.org.id, txHash: hash }, fast));
      const good = (await buildTransaction(tx, { cfg, reader: s.reader }, s.admin, "REGISTER_ORGANISATION", s.org.id, {}, { now: NOW })).data;
      return {
        wrongChain: await record(s.rpc.addTx({ from: s.adminWallet, data: good, chainId: 1n }).hash),
        wrongContract: await record(s.rpc.addTx({ from: s.adminWallet, data: good, to: "0x" + "de".repeat(20) }).hash),
        notRegistry: await record(s.rpc.addTx({ from: s.adminWallet, data: "0xdeadbeef" }).hash),
        otherOrg: await record(s.rpc.addTx({ from: s.adminWallet, data: encodeRegisterOrganisation(hex32(), metadataHashOf(s.org.slug)) }).hash),
        otherMetadata: await record(s.rpc.addTx({ from: s.adminWallet, data: encodeRegisterOrganisation(s.org.orgId, hex32()) }).hash),
        unknown: await record(hex32()),
        badHash: await record("0x1234"),
        noRows: await tx.blockchainTransaction.count({ where: { targetId: s.org.id } }),
      };
    });
    expect(r.wrongChain).toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/different chain/) });
    expect(r.wrongContract).toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/registry/) });
    expect(r.notRegistry).toMatchObject({ code: "VALIDATION" });
    expect(r.otherOrg).toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/calldata/) });
    expect(r.otherMetadata).toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/calldata/) });
    expect(r.unknown).toMatchObject({ code: "CONFLICT" });
    expect(r.badHash).toMatchObject({ code: "VALIDATION" });
    expect(r.noRows).toBe(0); // nothing was recorded for any rejected report
  });

  it("the sending wallet must hold the platform admin role on-chain (wrong wallet is refused)", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const { sent } = await buildAndBroadcast(tx, s, s.admin, "REGISTER_ORGANISATION", s.org.id, {}, freshWallet().address); // not an admin wallet
      return caught(recordSubmittedTransaction(tx, { cfg, rpc: s.rpc, reader: s.reader }, s.admin, { purpose: "REGISTER_ORGANISATION", targetId: s.org.id, txHash: sent.hash }, fast));
    });
    expect(r).toMatchObject({ code: "FORBIDDEN" });
  });

  it("roles are enforced: issuers and candidates cannot build admin transactions; admins cannot build issuer ones", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const issuer = await issuerOf(tx, s.org.id);
      const candidate: Actor = { ...s.admin, role: "CANDIDATE" };
      const build = (actor: Actor, purpose: TxPurpose) => caught(buildTransaction(tx, { cfg, reader: s.reader }, actor, purpose, s.org.id, {}, { now: NOW }));
      return {
        issuer: await build(issuer, "REGISTER_ORGANISATION"),
        candidate: await build(candidate, "REGISTER_ORGANISATION"),
        adminAnchor: await build(s.admin, "ANCHOR_COHORT"),
        adminRevoke: await build(s.admin, "REVOKE_CREDENTIAL"),
      };
    });
    for (const e of Object.values(r)) expect(e).toMatchObject({ code: "FORBIDDEN" });
  });

  it("registration is refused for an organisation that is already registered", async () => {
    const err = await inRollback(async (tx) => {
      const s = await setup(tx);
      const active = await mkOrg(tx, "ACTIVE");
      return caught(buildTransaction(tx, { cfg, reader: s.reader }, s.admin, "REGISTER_ORGANISATION", active.id, {}, { now: NOW }));
    });
    expect(err).toMatchObject({ code: "CONFLICT" });
  });

  it("status changes need a registered organisation and a different status", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const active = await mkOrg(tx, "ACTIVE");
      const b = (id: string, status?: "ACTIVE" | "SUSPENDED") => caught(buildTransaction(tx, { cfg, reader: s.reader }, s.admin, "SET_ORGANISATION_STATUS", id, { status }, { now: NOW }));
      return {
        notRegistered: await b(s.org.id, "SUSPENDED"),
        unchanged: await b(active.id, "ACTIVE"),
        missing: await b(active.id, undefined),
        ok: await buildTransaction(tx, { cfg, reader: s.reader }, s.admin, "SET_ORGANISATION_STATUS", active.id, { status: "SUSPENDED" }, { now: NOW }),
      };
    });
    expect(r.notRegistered).toMatchObject({ code: "CONFLICT" });
    expect(r.unchanged).toMatchObject({ code: "CONFLICT" });
    expect(r.missing).toMatchObject({ code: "VALIDATION" });
    expect(decodeRegistryCall(r.ok.data)).toMatchObject({ name: "setOrganisationStatus", args: { status: 2n } });
  });

  it("wallet governance: authorise needs a valid, never-used wallet; rotate needs a FRESH wallet; compromise is bounded", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const org = await mkOrg(tx, "ACTIVE");
      const used = freshWallet();
      const key = await addKey(tx, org.id, used);
      const fresh = freshWallet().address;
      const env = { cfg, reader: s.reader };
      const b = (purpose: TxPurpose, id: string, params: Parameters<typeof buildTransaction>[5]) => caught(buildTransaction(tx, env, s.admin, purpose, id, params, { now: NOW }));
      const okAuthorise = await buildTransaction(tx, env, s.admin, "AUTHORISE_ISSUER_KEY", org.id, { wallet: fresh }, { now: NOW });
      const okRotate = await buildTransaction(tx, env, s.admin, "RETIRE_ISSUER_KEY", key.id, { newWallet: freshWallet().address }, { now: NOW });
      const okRetire = await buildTransaction(tx, env, s.admin, "RETIRE_ISSUER_KEY", key.id, {}, { now: NOW });
      const okCompromise = await buildTransaction(tx, env, s.admin, "MARK_ISSUER_KEY_COMPROMISED", key.id, { compromisedAt: BigInt(Math.floor(NOW.getTime() / 1000)) - 3600n }, { now: NOW });
      return {
        reuse: await b("AUTHORISE_ISSUER_KEY", org.id, { wallet: used.address }),
        invalid: await b("AUTHORISE_ISSUER_KEY", org.id, { wallet: "0x1234" }),
        zero: await b("AUTHORISE_ISSUER_KEY", org.id, { wallet: "0x" + "00".repeat(20) }),
        rotateReuse: await b("RETIRE_ISSUER_KEY", key.id, { newWallet: used.address }),
        tooEarly: await b("MARK_ISSUER_KEY_COMPROMISED", key.id, { compromisedAt: 1n }),
        future: await b("MARK_ISSUER_KEY_COMPROMISED", key.id, { compromisedAt: BigInt(Math.floor(NOW.getTime() / 1000)) + 86400n }),
        okAuthorise,
        okRotate,
        okRetire,
        okCompromise,
        inactiveOrg: await b("AUTHORISE_ISSUER_KEY", (await mkOrg(tx, "SUSPENDED")).id, { wallet: freshWallet().address }),
      };
    });
    expect(r.reuse).toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/never be authorised again/) });
    expect(r.invalid).toMatchObject({ code: "VALIDATION" });
    expect(r.zero).toMatchObject({ code: "VALIDATION" });
    expect(r.rotateReuse).toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/fresh/) });
    expect(r.tooEarly).toMatchObject({ code: "VALIDATION" });
    expect(r.future).toMatchObject({ code: "VALIDATION" });
    expect(r.inactiveOrg).toMatchObject({ code: "CONFLICT" });
    expect(decodeRegistryCall(r.okAuthorise.data)?.name).toBe("authoriseIssuerWallet");
    expect(decodeRegistryCall(r.okRotate.data)?.name).toBe("rotateIssuerWallet");
    expect(decodeRegistryCall(r.okRetire.data)?.name).toBe("retireIssuerWallet");
    expect(decodeRegistryCall(r.okCompromise.data)?.name).toBe("markIssuerWalletCompromised");
  });
});

describe("issuer transactions: revocation ownership", () => {
  async function setup(tx: Tx) {
    const org = await mkOrg(tx, "ACTIVE");
    const issuer = await issuerOf(tx, org.id);
    const wallet = freshWallet();
    await addKey(tx, org.id, wallet);
    const rpc = new FakeRpc();
    const reader = new FakeReader();
    const f = await approvedCredential(tx, PERMANENT, { orgId: org.id, issuer });
    await signCredential(tx, f, wallet, { enqueue: false });
    const cred = await tx.credential.findUniqueOrThrow({ where: { id: f.credentialRowId } });
    return { org, issuer, wallet, rpc, reader, f, cred };
  }
  const env = (s: { rpc: FakeRpc; reader: FakeReader }) => ({ cfg, rpc: s.rpc, reader: s.reader });

  it("builds revokeCredential from the database (orgId, credentialSalt, reason) and records it", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const { built, sent } = await buildAndBroadcast(tx, s, s.issuer, "REVOKE_CREDENTIAL", s.cred.id, { reason: "FRAUD" }, s.wallet.address);
      const rec = await recordSubmittedTransaction(tx, env(s), s.issuer, { purpose: "REVOKE_CREDENTIAL", targetId: s.cred.id, txHash: sent.hash }, fast);
      return { s, built, rec, row: await tx.blockchainTransaction.findUniqueOrThrow({ where: { id: rec.id } }) };
    });
    expect(decodeRegistryCall(r.built.data)).toMatchObject({ name: "revokeCredential", args: { orgId: r.s.org.orgId, credentialSalt: r.s.cred.credentialSalt, reasonCode: 2n } });
    expect(r.built.warnings.join(" ")).toMatch(/credentialSalt/);
    expect(r.row).toMatchObject({ purpose: "REVOKE_CREDENTIAL", targetType: "CREDENTIAL", targetId: r.s.cred.id, organisationId: r.s.org.id, status: "PENDING" });
  });

  it("the browser cannot choose the credential: another organisation's credential is NOT_FOUND to build or record", async () => {
    const r = await inRollback(async (tx) => {
      const a = await setup(tx);
      const b = await setup(tx);
      const build = await caught(buildTransaction(tx, { cfg, reader: b.reader }, b.issuer, "REVOKE_CREDENTIAL", a.cred.id, { reason: "FRAUD" }, { now: NOW }));
      // B hand-crafts calldata revoking A's salt under B's org and tries to pass it off for A's credential row
      const crafted = b.rpc.addTx({ from: b.wallet.address, data: encodeRevokeCredential(a.org.orgId, a.cred.credentialSalt!, "FRAUD") });
      const record = await caught(recordSubmittedTransaction(tx, env(b), b.issuer, { purpose: "REVOKE_CREDENTIAL", targetId: a.cred.id, txHash: crafted.hash }, fast));
      return { build, record, rows: await tx.blockchainTransaction.count({ where: { targetId: a.cred.id } }) };
    });
    expect(r.build).toMatchObject({ code: "NOT_FOUND" });
    expect(r.record).toMatchObject({ code: "NOT_FOUND" });
    expect(r.rows).toBe(0);
  });

  it("calldata with a different salt or organisation than the database's is rejected", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const record = (data: string) => caught(recordSubmittedTransaction(tx, env(s), s.issuer, { purpose: "REVOKE_CREDENTIAL", targetId: s.cred.id, txHash: s.rpc.addTx({ from: s.wallet.address, data }).hash }, fast));
      return {
        salt: await record(encodeRevokeCredential(s.org.orgId, hex32(), "FRAUD")),
        org: await record(encodeRevokeCredential(hex32(), s.cred.credentialSalt!, "FRAUD")),
        ok: await record(encodeRevokeCredential(s.org.orgId, s.cred.credentialSalt!, "OTHER")),
      };
    });
    expect(r.salt).toMatchObject({ code: "VALIDATION" });
    expect(r.org).toMatchObject({ code: "VALIDATION" });
    expect(r.ok).toBeNull();
  });

  it("only an issued credential that is not already revoked can be revoked; unsigned and revoked ones are refused", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const unsigned = await approvedCredential(tx, PERMANENT, { orgId: s.org.id, issuer: s.issuer });
      const build = (id: string) => caught(buildTransaction(tx, { cfg, reader: s.reader }, s.issuer, "REVOKE_CREDENTIAL", id, { reason: "ISSUED_IN_ERROR" }, { now: NOW }));
      const unsignedErr = await build(unsigned.credentialRowId);
      const revTx = await mkFinalizedTx(tx, "REVOKE_CREDENTIAL", s.org.id, "CREDENTIAL", s.cred.id);
      const key = await tx.issuerKey.findFirstOrThrow({ where: { organisationId: s.org.id } });
      await tx.revocation.create({ data: { credentialRowId: s.cred.id, organisationId: s.org.id, revokerKeyId: key.id, reasonCode: "FRAUD", transactionId: revTx.id, blockNumber: 1n, revokedAt: NOW } });
      return { unsignedErr, revoked: await build(s.cred.id), noReason: await caught(buildTransaction(tx, { cfg, reader: s.reader }, s.issuer, "REVOKE_CREDENTIAL", s.cred.id, {}, { now: NOW })) };
    });
    expect(r.unsignedErr).toMatchObject({ code: "CONFLICT" });
    expect(r.revoked).toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/already revoked/) });
    expect(r.noReason).toMatchObject({ code: "VALIDATION" });
  });

  it("sender authority: the wallet must be an authorised wallet of the issuer's own organisation, and its bound operator", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const send = (from: string, actor: Actor = s.issuer) =>
        caught(
          (async () => {
            const built = await buildTransaction(tx, { cfg, reader: s.reader }, actor, "REVOKE_CREDENTIAL", s.cred.id, { reason: "FRAUD" }, { now: NOW });
            const sent = s.rpc.addTx({ from, data: built.data, nonce: Math.floor(Math.random() * 1e6) });
            return recordSubmittedTransaction(tx, env(s), actor, { purpose: "REVOKE_CREDENTIAL", targetId: s.cred.id, txHash: sent.hash }, fast);
          })(),
        );
      const stranger = await send(freshWallet().address);
      // a wallet of ANOTHER organisation
      const other = await mkOrg(tx, "ACTIVE");
      const otherWallet = freshWallet();
      await addKey(tx, other.id, otherWallet);
      const foreign = await send(otherWallet.address);
      // a hand-made key (authorisation never finalised)
      const handMade = freshWallet();
      await addKey(tx, s.org.id, handMade, { withoutAuthoriseTx: true });
      const unfinalised = await send(handMade.address);
      // a wallet bound to a colleague
      const { member } = await mkMember(tx, s.org.id);
      const bound = freshWallet();
      await addKey(tx, s.org.id, bound, { operatorMemberId: member.id });
      const boundToOther = await send(bound.address);
      const good = await send(s.wallet.address);
      return { stranger, foreign, unfinalised, boundToOther, good };
    });
    expect(r.stranger).toMatchObject({ code: "FORBIDDEN" });
    expect(r.foreign).toMatchObject({ code: "FORBIDDEN" });
    expect(r.unfinalised).toMatchObject({ code: "FORBIDDEN" });
    expect(r.boundToOther).toMatchObject({ code: "FORBIDDEN" });
    expect(r.good).toBeNull();
  });
});

describe("issuer transactions: anchors and the D7 policy", () => {
  async function setup(tx: Tx) {
    const org = await mkOrg(tx, "ACTIVE");
    const issuer = await issuerOf(tx, org.id);
    const wallet = freshWallet();
    await addKey(tx, org.id, wallet);
    return { org, issuer, wallet, rpc: new FakeRpc(), reader: new FakeReader() };
  }

  it("builds anchorCohortRoot from the SEALED batch and the chain head; refuses an open or foreign batch", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const f = await approvedCredential(tx, PERMANENT, { orgId: s.org.id, issuer: s.issuer });
      await signCredential(tx, f, s.wallet);
      const open = await tx.cohortBatch.findFirstOrThrow({ where: { organisationId: s.org.id } });
      const whileOpen = await caught(buildTransaction(tx, { cfg, reader: s.reader }, s.issuer, "ANCHOR_COHORT", open.id, {}, { now: SIGN_NOW }));
      const sealed = await sealCohortBatch(tx, s.issuer, { now: SIGN_NOW });
      const head = hex32();
      s.reader.heads.set(`${s.org.orgId}:COHORT`, { chainRoot: head, epoch: 3n });
      const built = await buildTransaction(tx, { cfg, reader: s.reader }, s.issuer, "ANCHOR_COHORT", sealed.batchId, {}, { now: SIGN_NOW });
      const other = await setup(tx);
      const foreign = await caught(buildTransaction(tx, { cfg, reader: other.reader }, other.issuer, "ANCHOR_COHORT", sealed.batchId, {}, { now: SIGN_NOW }));
      // record: tampered leaf count / root are rejected, a stale previous chain root is accepted (the chain decides)
      const record = (data: string) => caught(recordSubmittedTransaction(tx, { cfg, rpc: s.rpc, reader: s.reader }, s.issuer, { purpose: "ANCHOR_COHORT", targetId: sealed.batchId, txHash: s.rpc.addTx({ from: s.wallet.address, data, nonce: Math.floor(Math.random() * 1e6) }).hash }, fast));
      const call = decodeRegistryCall(built.data)!;
      const enc = (over: Record<string, unknown>) => registryInterface.encodeFunctionData("anchorCohortRoot", [call.args.orgId, over.batchRoot ?? call.args.batchRoot, over.leafCount ?? call.args.leafCount, over.schemaId ?? call.args.schemaId, over.prev ?? call.args.expectedPreviousChainRoot]);
      return {
        sealed,
        head,
        built,
        call,
        whileOpen,
        foreign,
        badCount: await record(enc({ leafCount: 99 })),
        badRoot: await record(enc({ batchRoot: hex32() })),
        badSchema: await record(enc({ schemaId: hex32() })),
        stalePrev: await record(enc({ prev: hex32() })),
      };
    });
    expect(r.whileOpen).toMatchObject({ code: "CONFLICT" });
    expect(r.foreign).toMatchObject({ code: "NOT_FOUND" });
    expect(r.call.args).toMatchObject({ batchRoot: r.sealed.batchRoot, leafCount: BigInt(r.sealed.leafCount), schemaId: SCHEMA_ID, expectedPreviousChainRoot: r.head });
    expect(r.badCount).toMatchObject({ code: "VALIDATION" });
    expect(r.badRoot).toMatchObject({ code: "VALIDATION" });
    expect(r.badSchema).toMatchObject({ code: "VALIDATION" });
    expect(r.stalePrev).toBeNull();
  });

  it("starts a new chain from the zero hash when the chain is empty", async () => {
    const built = await inRollback(async (tx) => {
      const s = await setup(tx);
      const f = await approvedCredential(tx, PERMANENT, { orgId: s.org.id, issuer: s.issuer });
      await signCredential(tx, f, s.wallet);
      const sealed = await sealCohortBatch(tx, s.issuer, { now: SIGN_NOW });
      return buildTransaction(tx, { cfg, reader: s.reader }, s.issuer, "ANCHOR_COHORT", sealed.batchId, {}, { now: SIGN_NOW });
    });
    expect(decodeRegistryCall(built.data)?.args.expectedPreviousChainRoot).toBe(ZERO_HASH);
  });

  it("D7: warns after 21 days, still builds after 30 days when only SOME leaves are stale, and refuses when EVERY leaf is stale", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const f = await approvedCredential(tx, PERMANENT, { orgId: s.org.id, issuer: s.issuer });
      await signCredential(tx, f, s.wallet); // signed at SIGN_NOW (2026-10-16T10:00Z)
      const sealed = await sealCohortBatch(tx, s.issuer, { now: SIGN_NOW });
      const at = (days: number) => buildTransaction(tx, { cfg, reader: s.reader }, s.issuer, "ANCHOR_COHORT", sealed.batchId, {}, { now: new Date(SIGN_NOW.getTime() + days * DAY) });
      return { fresh: await at(1), warn: await at(22), refused: await caught(at(31)) };
    });
    expect(r.fresh.warnings).toEqual([]);
    expect(r.warn.warnings.join(" ")).toMatch(/21 days/);
    expect(r.refused).toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/30 days/) });
  });

  it("D7: a batch with a fresh leaf is still anchorable although an older leaf is past 30 days (it warns, never strands the fresh one)", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      const old = await approvedCredential(tx, PERMANENT, { orgId: s.org.id, issuer: s.issuer });
      await signCredential(tx, old, s.wallet, { now: SIGN_NOW });
      const fresh = await approvedCredential(tx, PERMANENT, { orgId: s.org.id, issuer: s.issuer });
      await signCredential(tx, fresh, s.wallet, { now: new Date(SIGN_NOW.getTime() + 25 * DAY) });
      const sealed = await sealCohortBatch(tx, s.issuer, { now: new Date(SIGN_NOW.getTime() + 25 * DAY) });
      return buildTransaction(tx, { cfg, reader: s.reader }, s.issuer, "ANCHOR_COHORT", sealed.batchId, {}, { now: new Date(SIGN_NOW.getTime() + 33 * DAY) });
    });
    expect(r.warnings.join(" ")).toMatch(/more than 30 days ago/);
  });

  it("builds anchorProofPulseEpoch from the update log (current or an earlier rootSeq) and refuses roots older than the chain's", async () => {
    const r = await inRollback(async (tx) => {
      const s = await setup(tx);
      for (let i = 0; i < 2; i++) {
        const f = await approvedCredential(tx, CONTINUING, { orgId: s.org.id, issuer: s.issuer });
        await signCredential(tx, f, s.wallet);
      }
      const tree = await tx.proofPulseTree.findUniqueOrThrow({ where: { organisationId: s.org.id } });
      const updates = await tx.proofPulseUpdate.findMany({ where: { treeId: tree.id }, orderBy: { rootSeq: "asc" } });
      const env = { cfg, reader: s.reader };
      const current = await buildTransaction(tx, env, s.issuer, "ANCHOR_PROOF_PULSE", tree.id, {}, { now: SIGN_NOW });
      const earlier = await buildTransaction(tx, env, s.issuer, "ANCHOR_PROOF_PULSE", tree.id, { rootSeq: 1n }, { now: SIGN_NOW });
      const beyond = await caught(buildTransaction(tx, env, s.issuer, "ANCHOR_PROOF_PULSE", tree.id, { rootSeq: 9n }, { now: SIGN_NOW }));
      s.reader.lastSeq = 2n;
      const stale = await caught(buildTransaction(tx, env, s.issuer, "ANCHOR_PROOF_PULSE", tree.id, { rootSeq: 1n }, { now: SIGN_NOW }));
      const reaffirm = await buildTransaction(tx, env, s.issuer, "ANCHOR_PROOF_PULSE", tree.id, {}, { now: SIGN_NOW });
      // record: tampered rootSeq/leafCount
      const rec = (data: string) => caught(recordSubmittedTransaction(tx, { cfg, rpc: s.rpc, reader: s.reader }, s.issuer, { purpose: "ANCHOR_PROOF_PULSE", targetId: tree.id, txHash: s.rpc.addTx({ from: s.wallet.address, data, nonce: Math.floor(Math.random() * 1e6) }).hash }, fast));
      const call = decodeRegistryCall(current.data)!;
      const enc = (a: Record<string, unknown>) => registryInterface.encodeFunctionData("anchorProofPulseEpoch", [call.args.orgId, a.batchRoot ?? call.args.batchRoot, a.rootSeq ?? call.args.rootSeq, a.leafCount ?? call.args.leafCount, call.args.expectedPreviousChainRoot]);
      return { updates, tree, current, earlier, beyond, stale, reaffirm, badLeafCount: await rec(enc({ leafCount: 7 })), badRoot: await rec(enc({ batchRoot: hex32() })), earlierOk: await rec(enc({ rootSeq: 1n, batchRoot: updates[0].newRoot, leafCount: 1 })) };
    });
    expect(decodeRegistryCall(r.current.data)?.args).toMatchObject({ batchRoot: r.updates[1].newRoot, rootSeq: 2n, leafCount: 2n });
    expect(decodeRegistryCall(r.earlier.data)?.args).toMatchObject({ batchRoot: r.updates[0].newRoot, rootSeq: 1n, leafCount: 1n });
    expect(r.current.targetSequence).toBe(2);
    expect(r.beyond).toMatchObject({ code: "CONFLICT" });
    expect(r.stale).toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/newer/) });
    expect(r.reaffirm.targetSequence).toBe(2); // equal rootSeq: re-affirming "still current" is allowed
    expect(r.badLeafCount).toMatchObject({ code: "VALIDATION" });
    expect(r.badRoot).toMatchObject({ code: "VALIDATION" });
    expect(r.earlierOk).toBeNull();
  });
});
