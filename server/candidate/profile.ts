import type { Actor } from "@/lib/auth/authorize";
import type { Prisma, PrismaClient } from "@/lib/database/generated/client";
import { DomainError } from "./errors";

// Candidate profile and visibility services (ROADMAP Phase 11/13). The existing schema already holds everything
// needed: Profile.handle (unique, format-checked in the database), Profile.visibility and Claim.visibility. All
// default to PRIVATE; nothing becomes public unless the candidate chooses it, and the candidate id is always
// `actor.userId`, never read from input.
//
// Visibility model:
//   Profile.visibility  PUBLIC / UNLISTED -> the profile page /p/{handle} resolves; PRIVATE -> it does not exist.
//   Claim.visibility    PUBLIC   -> listed on the profile (if the profile resolves) AND its verifier link works;
//                       UNLISTED -> not listed, but its verifier link works for whoever holds it;
//                       PRIVATE  -> neither.

export type ProfileDb = Pick<PrismaClient, "profile" | "claim" | "auditEvent"> & Partial<Pick<PrismaClient, "$transaction">>;
type Tx = Prisma.TransactionClient;

export const VISIBILITIES = ["PUBLIC", "UNLISTED", "PRIVATE"] as const;
export type VisibilityName = (typeof VISIBILITIES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVED_HANDLES = new Set(["admin", "api", "auth", "candidate", "issuer", "login", "signup", "verify", "farji", "support", "help", "www", "static", "p"]);

function assertCandidate(actor: Actor): void {
  if (!actor || actor.role !== "CANDIDATE" || !UUID.test(actor.userId ?? "")) throw new DomainError("FORBIDDEN", "Only a candidate can do this.");
}

async function inTransaction<T>(db: ProfileDb, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction ? db.$transaction(fn) : fn(db as unknown as Tx);
}

export type OwnProfile = { handle: string; displayName: string; headline: string | null; about: string | null; location: string | null; visibility: VisibilityName };

export async function getOwnProfile(db: ProfileDb, actor: Actor): Promise<OwnProfile | null> {
  assertCandidate(actor);
  return db.profile.findUnique({ where: { userId: actor.userId }, select: { handle: true, displayName: true, headline: true, about: true, location: true, visibility: true } });
}

/** A starting handle suggestion from a display name (lowercase, hyphenated). Never reserved or invalid. */
export function suggestHandle(displayName: string): string {
  const base = displayName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return HANDLE_PATTERN.test(base) && !RESERVED_HANDLES.has(base) ? base : "";
}

export type ProfileValidation = { ok: true; value: OwnProfile } | { ok: false; errors: Record<string, string> };

export function validateProfile(raw: Record<string, unknown>): ProfileValidation {
  const errors: Record<string, string> = {};
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string).trim() : "");
  const handle = str("handle").toLowerCase();
  const displayName = str("displayName");
  const headline = str("headline");
  const about = str("about");
  const location = str("location");
  const visibilityRaw = str("visibility") || "PRIVATE";

  if (!HANDLE_PATTERN.test(handle)) errors.handle = "Use 3 to 40 lowercase letters, numbers or hyphens, starting and ending with a letter or number.";
  else if (RESERVED_HANDLES.has(handle)) errors.handle = "That handle is reserved. Choose another.";
  if (!displayName) errors.displayName = "Your name is required.";
  else if (displayName.length > 100) errors.displayName = "Your name must be at most 100 characters.";
  if (headline.length > 160) errors.headline = "The headline must be at most 160 characters.";
  if (about.length > 2000) errors.about = "The summary must be at most 2000 characters.";
  if (location.length > 100) errors.location = "The location must be at most 100 characters.";
  if (!(VISIBILITIES as readonly string[]).includes(visibilityRaw)) errors.visibility = "Choose who can see your profile.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { handle, displayName, headline: headline || null, about: about || null, location: location || null, visibility: visibilityRaw as VisibilityName } };
}

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

/** Creates or updates the candidate's own profile. A new profile is PRIVATE unless the candidate chose otherwise. */
export async function saveProfile(db: ProfileDb, actor: Actor, raw: Record<string, unknown>): Promise<OwnProfile> {
  assertCandidate(actor);
  const v = validateProfile(raw);
  if (!v.ok) throw new DomainError("VALIDATION", "Please correct the highlighted fields.", v.errors);
  try {
    return await inTransaction(db, async (tx) => {
      const existing = await tx.profile.findUnique({ where: { userId: actor.userId }, select: { id: true, visibility: true } });
      const saved = existing
        ? await tx.profile.update({ where: { userId: actor.userId }, data: v.value, select: { handle: true, displayName: true, headline: true, about: true, location: true, visibility: true } })
        : await tx.profile.create({ data: { ...v.value, userId: actor.userId }, select: { handle: true, displayName: true, headline: true, about: true, location: true, visibility: true } });
      await tx.auditEvent.create({
        data: {
          actorUserId: actor.userId,
          actorRole: "CANDIDATE",
          action: existing ? (existing.visibility !== v.value.visibility ? "PROFILE_VISIBILITY_CHANGED" : "PROFILE_UPDATED") : "PROFILE_CREATED",
          targetType: "Profile",
          targetId: actor.userId,
          metadata: { visibility: v.value.visibility },
        },
      });
      return saved;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainError("VALIDATION", "That handle is already taken.", { handle: "That handle is already taken." });
    throw e;
  }
}

/** Sets who can see ONE of the candidate's own claims. Another candidate's claim is indistinguishable from a missing one. */
export async function setClaimVisibility(db: ProfileDb, actor: Actor, claimId: string, visibility: unknown): Promise<VisibilityName> {
  assertCandidate(actor);
  if (typeof claimId !== "string" || !UUID.test(claimId)) throw new DomainError("NOT_FOUND", "Record not found.");
  if (typeof visibility !== "string" || !(VISIBILITIES as readonly string[]).includes(visibility)) throw new DomainError("VALIDATION", "Choose who can see this record.", { visibility: "Choose who can see this record." });
  return inTransaction(db, async (tx) => {
    const { count } = await tx.claim.updateMany({ where: { id: claimId, candidateId: actor.userId }, data: { visibility: visibility as VisibilityName } });
    if (count !== 1) throw new DomainError("NOT_FOUND", "Record not found.");
    await tx.auditEvent.create({
      data: { actorUserId: actor.userId, actorRole: "CANDIDATE", action: "CLAIM_VISIBILITY_CHANGED", targetType: "Claim", targetId: claimId, metadata: { visibility } },
    });
    return visibility as VisibilityName;
  });
}
