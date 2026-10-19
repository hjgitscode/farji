import { randomUUID } from "node:crypto";
import { Contract, JsonRpcProvider, Wallet, type TransactionResponse } from "ethers";
import { inject } from "vitest";
import abi from "@/lib/blockchain/farji-registry.abi.json";
import type { Actor } from "@/lib/auth/authorize";
import type { TxPurpose } from "@/lib/database/generated/client";
import type { ChainConfig } from "@/server/chain/config";
import { createChainReader } from "@/server/chain/reader";
import { ethersRpc } from "@/server/chain/rpc";
import { syncTransaction } from "@/server/chain/sync";
import { buildTransaction, recordSubmittedTransaction, type BuiltTransaction } from "@/server/chain/transactions";
import { acceptWalletBinding, prepareWalletBinding } from "@/server/issuance/wallet-binding";
import { HARDHAT_ACCOUNT_0_KEY } from "../fixtures/test-wallets";
import { mkOrg, mkUser, type Tx } from "../db/helpers";
import { issuerOf } from "../db/issuance-helpers";

// Integration harness: everything here talks to a REAL local Hardhat node running the REAL
// FarjiRegistry (started by global-setup.ts). The only "fixtures" are Hardhat's public development
// accounts and throw-away random wallets, which exist solely in tests/.

export type Env = ReturnType<typeof createEnv>;

let cached: Env | null = null;

export function createEnv() {
  const fx = inject("chain");
  const provider = new JsonRpcProvider(fx.rpcUrl, fx.chainId, { staticNetwork: true, cacheTimeout: -1 });
  const cfg: ChainConfig = { rpcUrl: fx.rpcUrl, chainId: BigInt(fx.chainId), registry: fx.registry, finality: { mode: "depth", depth: 2 } };
  return {
    provider,
    cfg,
    rpc: ethersRpc(provider),
    reader: createChainReader(provider, cfg),
    adminWallet: new Wallet(HARDHAT_ACCOUNT_0_KEY, provider),
    registry: new Contract(fx.registry, abi as never, provider),
    eip: { chainId: BigInt(fx.chainId), verifyingContract: fx.registry },
  };
}

export const env = (): Env => (cached ??= createEnv());

/** Mines `n` empty blocks (local node only). */
export async function mine(n: number) {
  for (let i = 0; i < n; i++) await env().provider.send("evm_mine", []);
}

export async function chainNowSeconds(): Promise<number> {
  const b = await env().provider.getBlock("latest");
  return b!.timestamp;
}

/** The app clock used for signing: just after the node's latest block, so key validity lines up. */
export async function signingClock(plusSeconds = 5): Promise<Date> {
  return new Date(((await chainNowSeconds()) + plusSeconds) * 1000);
}

export async function fund(address: string) {
  const sent = await env().adminWallet.sendTransaction({ to: address, value: 10n ** 18n });
  await sent.wait();
}

/** The WALLET (not the server) broadcasts the transaction the server built. */
export async function send(wallet: Wallet, built: BuiltTransaction, over: { gasLimit?: bigint; nonce?: number } = {}): Promise<TransactionResponse> {
  return wallet.connect(env().provider).sendTransaction({ to: built.to, data: built.data, ...over });
}

export async function adminActor(tx: Tx): Promise<Actor> {
  return { userId: (await mkUser(tx, "ADMIN")).id, authUserId: randomUUID(), role: "ADMIN", organisationId: null, organisationStatus: null, memberId: null };
}

export const recordOpts = { attempts: 20, delayMs: 100 };

/** Build -> wallet sends -> server records the reported hash. Returns the recorded row id and hash. */
export async function buildSendRecord(tx: Tx, actor: Actor, wallet: Wallet, purpose: TxPurpose, targetId: string, params: Parameters<typeof buildTransaction>[5] = {}, now = new Date()) {
  const e = env();
  const built = await buildTransaction(tx, { cfg: e.cfg, reader: e.reader }, actor, purpose, targetId, params, { now });
  const sent = await send(wallet, built);
  const rec = await recordSubmittedTransaction(tx, { cfg: e.cfg, rpc: e.rpc, reader: e.reader }, actor, { purpose, targetId, txHash: sent.hash }, { ...recordOpts, now });
  return { built, sent, rec };
}

/** Syncs a recorded transaction: first right after mining (CONFIRMED), then after the finality depth. */
export async function sync(tx: Tx, rowId: string) {
  const e = env();
  return syncTransaction(tx, { cfg: e.cfg, rpc: e.rpc }, rowId, { now: new Date() });
}

/** Mines to the configured depth (2) and syncs: the transaction becomes FINALIZED and is mirrored. */
export async function finalise(tx: Tx, rowId: string) {
  await mine(2);
  return sync(tx, rowId);
}

export type Onboarded = Awaited<ReturnType<typeof onboard>>;

/**
 * An organisation that exists ONLY through finalised chain evidence: registered by the admin wallet,
 * its issuer wallet authorised by the admin wallet, both mirrored at FINALIZED, and the issuer
 * member bound to the wallet by a real signature.
 */
export async function onboard(tx: Tx) {
  const e = env();
  const admin = await adminActor(tx);
  const org = await mkOrg(tx, "PENDING_ONBOARDING");
  const issuer = await issuerOf(tx, org.id);
  const wallet = new Wallet(Wallet.createRandom().privateKey, e.provider);
  await fund(wallet.address);

  const reg = await buildSendRecord(tx, admin, e.adminWallet, "REGISTER_ORGANISATION", org.id);
  await finalise(tx, reg.rec.id);
  const auth = await buildSendRecord(tx, admin, e.adminWallet, "AUTHORISE_ISSUER_KEY", org.id, { wallet: wallet.address });
  await finalise(tx, auth.rec.id);

  const clock = await signingClock();
  const prep = await prepareWalletBinding(tx, issuer, wallet.address, { config: e.eip, now: clock });
  const signature = await wallet.signTypedData(prep.typedData.domain, prep.typedData.types, prep.typedData.message);
  await acceptWalletBinding(tx, issuer, { wallet: wallet.address, signature, issuedAt: prep.issuedAt, nonce: prep.nonce }, { config: e.eip, now: clock });

  const key = await tx.issuerKey.findUniqueOrThrow({ where: { walletAddress: wallet.address.toLowerCase() } });
  return { admin, org: await tx.organisation.findUniqueOrThrow({ where: { id: org.id } }), issuer, wallet, key, authTx: auth.rec.id };
}
