import type { Actor } from "@/lib/auth/authorize";
import { validateClaimDraft } from "@/lib/core/claims";
import type { Prisma, PrismaClient } from "@/lib/database/generated/client";
import { IMPORT_LIMITS, normaliseOrganisationName, parseProfileImport, recordKey, type ImportDraft, type ParseResult } from "@/lib/import/parse";
import { createClaim } from "./claims";
import { DomainError } from "./errors";

// Professional-profile import service (ROADMAP Phase 11).
//
// TRUST RULE: imported data is NOT verified. The only way an imported record is stored is `createClaim` (the Phase 4
// service), so ownership, validation, lifecycle rules, ClaimVersion v1 and the CLAIM_CREATED audit event are exactly
// those of a manually added record. An imported record is a SELF_DECLARED claim with PRIVATE visibility. This module
// never creates a Credential, Attestation, Anchor, IssuerKey, Revocation or Organisation (a structural test enforces
// that), and it never attaches an imported name to a FARJI organisation by itself: a match is only SHOWN.
//
// Idempotency without a schema change: a transaction-scoped advisory lock serialises one candidate's imports, and
// every record is compared (normalised category, title, organisation, dates) with the candidate's existing records and
// with the earlier records of the same batch before it is created. A retried or double-submitted import therefore
// creates nothing the second time and reports the records as duplicates.

export type ImportDb = Pick<PrismaClient, "claim" | "organisation" | "auditEvent" | "$executeRaw"> & Partial<Pick<PrismaClient, "$transaction">>;
type Tx = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertCandidate(actor: Actor): void {
  if (!actor || actor.role !== "CANDIDATE" || !UUID.test(actor.userId ?? "")) throw new DomainError("FORBIDDEN", "Only a candidate can do this.");
}

export type PreviewItem = ImportDraft & {
  /** Already on the candidate's profile (the same normalised record). */
  duplicate: boolean;
  /** A FARJI organisation whose name matches exactly after normalisation. Informational only. */
  matchedOrganisation: { id: string; displayName: string } | null;
};

export type ImportPreview = { format: ParseResult["format"]; items: PreviewItem[]; warnings: string[] };

async function existingKeys(db: Pick<ImportDb, "claim">, candidateId: string): Promise<Set<string>> {
  const claims = await db.claim.findMany({
    where: { candidateId },
    select: { category: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { content: true } } },
  });
  const keys = new Set<string>();
  for (const c of claims) {
    const content = (c.versions[0]?.content ?? {}) as Record<string, unknown>;
    const s = (k: string) => (typeof content[k] === "string" ? (content[k] as string) : "");
    keys.add(recordKey({ category: c.category, title: s("title"), organisationName: s("organisationName"), startDate: s("startDate"), endDate: s("endDate"), expiryDate: s("expiryDate") }));
  }
  return keys;
}

/**
 * Parses and previews. WRITES NOTHING. Shows which records are already present and which FARJI organisation (if any)
 * matches a name exactly after normalisation; an ambiguous or fuzzy match is never offered.
 */
export async function previewImport(db: ImportDb, actor: Actor, text: unknown, now: Date = new Date()): Promise<ImportPreview> {
  assertCandidate(actor);
  if (typeof text !== "string") throw new DomainError("VALIDATION", "Paste your profile or choose a file.", { text: "Paste your profile or choose a file." });
  const parsed = parseProfileImport(text, now);
  const keys = await existingKeys(db, actor.userId);
  const orgs = await db.organisation.findMany({ where: { status: "ACTIVE" }, select: { id: true, displayName: true, legalName: true } });

  const byName = new Map<string, { id: string; displayName: string }[]>();
  for (const o of orgs) {
    for (const n of new Set([normaliseOrganisationName(o.displayName), normaliseOrganisationName(o.legalName)])) {
      if (!n) continue;
      byName.set(n, [...(byName.get(n) ?? []), { id: o.id, displayName: o.displayName }]);
    }
  }
  const items: PreviewItem[] = parsed.drafts.map((d) => {
    const hits = byName.get(normaliseOrganisationName(d.organisationName)) ?? [];
    const unique = [...new Map(hits.map((h) => [h.id, h])).values()];
    return {
      ...d,
      duplicate: !!d.category && keys.has(recordKey(d)),
      matchedOrganisation: unique.length === 1 ? unique[0] : null,
    };
  });
  return { format: parsed.format, items, warnings: parsed.warnings };
}

/** One record as the candidate confirmed it in the preview. Only these keys are ever read. */
export type ConfirmItem = Record<string, unknown> & { key?: unknown; confirmed?: unknown };

export type ImportItemResult =
  | { key: string; status: "CREATED"; claimId: string }
  | { key: string; status: "SKIPPED_DUPLICATE" }
  | { key: string; status: "INVALID"; errors: Record<string, string> };

export type ImportOutcome = { results: ImportItemResult[]; created: number; skipped: number; invalid: number };

const FIELDS = ["category", "lifecycleType", "title", "organisationName", "description", "location", "fieldOfStudy", "credentialNumber", "startDate", "endDate", "expiryDate"] as const;

async function inTransaction<T>(db: ImportDb, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction ? db.$transaction(fn, { timeout: 60000, maxWait: 10000 }) : fn(db as unknown as Tx);
}

/**
 * Creates SELF_DECLARED claims for the records the candidate selected AND explicitly confirmed. The candidate id is
 * `actor.userId`. Server-side checks repeat everything the preview showed: validation (by `createClaim`), duplicates
 * against the profile and the batch, and an explicit per-record confirmation.
 */
export async function confirmImport(db: ImportDb, actor: Actor, items: unknown, now: Date = new Date()): Promise<ImportOutcome> {
  assertCandidate(actor);
  if (!Array.isArray(items) || items.length === 0) throw new DomainError("VALIDATION", "Select at least one record to add.");
  if (items.length > IMPORT_LIMITS.maxItems) throw new DomainError("VALIDATION", `You can add at most ${IMPORT_LIMITS.maxItems} records at a time.`);

  return inTransaction(db, async (tx) => {
    // One import per candidate at a time: a double-click or retry waits here, then finds the records already present.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"farji-import:" + actor.userId}))`;
    const seen = await existingKeys(tx, actor.userId);

    const results: ImportItemResult[] = [];
    for (let i = 0; i < items.length; i++) {
      const raw = (items[i] && typeof items[i] === "object" ? items[i] : {}) as ConfirmItem;
      const key = typeof raw.key === "string" && raw.key.length <= 20 ? raw.key : `i${i}`;
      if (raw.confirmed !== true) {
        results.push({ key, status: "INVALID", errors: { confirmed: "Confirm that this record is correct before adding it." } });
        continue;
      }
      const input: Record<string, unknown> = {};
      for (const f of FIELDS) if (typeof raw[f] === "string") input[f] = raw[f];

      const checked = validateClaimDraft(input, now);
      if (!checked.ok) {
        results.push({ key, status: "INVALID", errors: checked.errors });
        continue;
      }
      const c = checked.value.content;
      const k = recordKey({ category: checked.value.category, title: c.title, organisationName: c.organisationName, startDate: c.startDate, endDate: c.endDate, expiryDate: c.expiryDate });
      if (seen.has(k)) {
        results.push({ key, status: "SKIPPED_DUPLICATE" });
        continue;
      }
      const { claimId } = await createClaim(tx as unknown as Parameters<typeof createClaim>[0], actor, input, now);
      seen.add(k);
      results.push({ key, status: "CREATED", claimId });
    }

    const created = results.filter((r) => r.status === "CREATED").length;
    await tx.auditEvent.create({
      data: {
        actorUserId: actor.userId,
        actorRole: "CANDIDATE",
        action: "PROFILE_IMPORT_CONFIRMED",
        targetType: "User",
        targetId: actor.userId,
        metadata: { submitted: items.length, created, skipped: results.filter((r) => r.status === "SKIPPED_DUPLICATE").length, invalid: results.filter((r) => r.status === "INVALID").length },
      },
    });
    return { results, created, skipped: results.filter((r) => r.status === "SKIPPED_DUPLICATE").length, invalid: results.filter((r) => r.status === "INVALID").length };
  });
}

