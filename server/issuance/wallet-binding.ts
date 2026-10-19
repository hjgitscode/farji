import type { Actor } from "@/lib/auth/authorize";
import { isBytes32, isLowerAddress, nowSeconds, uuidToBytes16 } from "@/lib/crypto/encoding";
import { buildWalletBindingTypedData, farjiDomain, normaliseSignature, recoverSigner, toWalletTypedData } from "@/lib/crypto/eip712";
import { DomainError } from "@/server/candidate/errors";
import { assertIssuer, assertStillActiveMember } from "@/server/issuer/review";
import { assertIssuedAtWindow, audit, inTransaction, parseIssuedAt, parseNonce, type IssuanceDb, type ServiceOptions } from "./common";
import { getEip712Config } from "./config";
import { randomBytes32 } from "./random";
import type { Eip712Config } from "@/lib/crypto/eip712";

// Wallet proof of possession (ROADMAP Phase 9, decision J).
//
// A browser-submitted wallet address is NEVER trusted. The issuer's wallet must SIGN a short-lived
// message that names the organisation, the member and the wallet; the server recovers the signer and
// requires it to equal the claimed wallet. Only then is `IssuerKey.operatorMemberId` bound (once).
// A bound wallet can then only be used by that member to sign credentials and send transactions.

export type BindingOptions = ServiceOptions & { config?: Eip712Config };

export async function prepareWalletBinding(db: IssuanceDb, actor: Actor, walletInput: string, opts: BindingOptions = {}) {
  const scope = assertIssuer(actor);
  const wallet = typeof walletInput === "string" ? walletInput.toLowerCase() : "";
  if (!isLowerAddress(wallet)) throw new DomainError("VALIDATION", "Invalid wallet address.", { wallet: "Invalid wallet address." });
  const domain = farjiDomain(opts.config ?? getEip712Config());
  const now = opts.now ?? new Date();
  const random = opts.random ?? randomBytes32;

  return inTransaction(db, async (tx) => {
    await assertStillActiveMember(tx, scope);
    const org = await tx.organisation.findUniqueOrThrow({ where: { id: scope.organisationId }, select: { orgId: true } });
    const typedData = buildWalletBindingTypedData(domain, {
      orgId: org.orgId,
      memberId: uuidToBytes16(scope.memberId),
      wallet,
      issuedAt: nowSeconds(now),
      nonce: random(),
    });
    return {
      issuedAt: typedData.message.issuedAt.toString(),
      nonce: typedData.message.nonce,
      typedData,
      walletTypedData: toWalletTypedData(typedData),
    };
  });
}

export type BindingResult = { issuerKeyId: string; walletAddress: string; operatorMemberId: string; alreadyBound: boolean };

export async function acceptWalletBinding(
  db: IssuanceDb,
  actor: Actor,
  input: { wallet: unknown; signature: unknown; issuedAt: unknown; nonce: unknown },
  opts: BindingOptions = {},
): Promise<BindingResult> {
  const scope = assertIssuer(actor);
  const wallet = typeof input?.wallet === "string" ? input.wallet.toLowerCase() : "";
  if (!isLowerAddress(wallet)) throw new DomainError("VALIDATION", "Invalid wallet address.", { wallet: "Invalid wallet address." });
  const issuedAt = parseIssuedAt(input.issuedAt);
  const nonce = parseNonce(input.nonce);
  const signature = normaliseSignature(input.signature);
  if (!signature) throw new DomainError("VALIDATION", "Invalid signature.", { signature: "Invalid signature." });
  const domain = farjiDomain(opts.config ?? getEip712Config());
  const now = opts.now ?? new Date();
  assertIssuedAtWindow(issuedAt, nowSeconds(now));

  return inTransaction(db, async (tx) => {
    await assertStillActiveMember(tx, scope);
    const org = await tx.organisation.findUniqueOrThrow({ where: { id: scope.organisationId }, select: { orgId: true } });
    if (!isBytes32(org.orgId)) throw new DomainError("CONFLICT", "The organisation identifier is malformed.");

    // The message is rebuilt from the ACTOR (their organisation and member), never from the request.
    const typedData = buildWalletBindingTypedData(domain, { orgId: org.orgId, memberId: uuidToBytes16(scope.memberId), wallet, issuedAt, nonce });
    const signer = recoverSigner(typedData, signature);
    if (!signer || signer !== wallet) {
      throw new DomainError("FORBIDDEN", "The signature was not made by that wallet.");
    }

    const key = await tx.issuerKey.findFirst({
      where: { walletAddress: wallet, organisationId: scope.organisationId },
      select: { id: true, validUntil: true, compromisedAt: true, operatorMemberId: true, authoriseTransaction: { select: { status: true } } },
    });
    if (!key || key.authoriseTransaction?.status !== "FINALIZED") {
      throw new DomainError("FORBIDDEN", "That wallet is not an authorised issuer wallet of your organisation.");
    }
    if (key.validUntil || key.compromisedAt) throw new DomainError("CONFLICT", "That wallet is retired or compromised.");
    if (key.operatorMemberId === scope.memberId) {
      return { issuerKeyId: key.id, walletAddress: wallet, operatorMemberId: scope.memberId, alreadyBound: true };
    }
    if (key.operatorMemberId) throw new DomainError("CONFLICT", "That wallet is already bound to another member.");

    const { count } = await tx.issuerKey.updateMany({ where: { id: key.id, operatorMemberId: null }, data: { operatorMemberId: scope.memberId } });
    if (count !== 1) throw new DomainError("CONFLICT", "That wallet was just bound by someone else.");
    await audit(tx, scope, "ISSUER_WALLET_BOUND", "IssuerKey", key.id, { memberId: scope.memberId });
    return { issuerKeyId: key.id, walletAddress: wallet, operatorMemberId: scope.memberId, alreadyBound: false };
  });
}
