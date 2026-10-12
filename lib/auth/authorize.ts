import type { PrismaClient } from "@/lib/database/generated/client";
import type { AppRole } from "./paths";
import { syncAppUser, type SyncDb } from "./user-sync";

// Pure(ish) server-side authorization core. No Next.js imports, so it is unit-testable.
//
// The role decision is made ONLY from the FARJI database (User.role). Supabase
// user_metadata / app_metadata are never read here: the only thing taken from Supabase
// is the verified user id.

export type ActorDb = SyncDb & Pick<PrismaClient, "organisationMember">;

/** Server-resolved identity for the current request (see SECURITY_MODEL §5). */
export type Actor = {
  userId: string;
  authUserId: string;
  role: AppRole;
  /** Set for ISSUER only, from an ACTIVE OrganisationMember row. Never from the request. */
  organisationId: string | null;
  /** Status of that organisation (ISSUER only); issuer access requires "ACTIVE". */
  organisationStatus: "PENDING_ONBOARDING" | "ACTIVE" | "SUSPENDED" | null;
  memberId: string | null;
};

export type ActorLoad =
  | { status: "ANONYMOUS" }
  | { status: "DISABLED" }
  | { status: "OK"; actor: Actor };

export type DenyReason =
  | "UNAUTHENTICATED"
  | "ACCOUNT_DISABLED"
  | "FORBIDDEN"
  | "NO_ORGANISATION"
  | "ORGANISATION_INACTIVE";

export type Authorization = { ok: true; actor: Actor } | { ok: false; reason: DenyReason };

/**
 * Loads the FARJI actor for a verified Supabase user id (null = not signed in).
 * Creates the CANDIDATE row if this is the user's first visit (idempotent).
 */
export async function loadActor(authUserId: string | null, db: ActorDb): Promise<ActorLoad> {
  if (!authUserId) return { status: "ANONYMOUS" };

  const { user } = await syncAppUser(db, authUserId);
  if (user.status !== "ACTIVE") return { status: "DISABLED" };

  let organisationId: string | null = null;
  let memberId: string | null = null;
  let organisationStatus: Actor["organisationStatus"] = null;
  if (user.role === "ISSUER") {
    const member = await db.organisationMember.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
      select: { id: true, organisationId: true, organisation: { select: { status: true } } },
    });
    organisationId = member?.organisationId ?? null;
    organisationStatus = member?.organisation.status ?? null;
    memberId = member?.id ?? null;
  }

  return {
    status: "OK",
    actor: { userId: user.id, authUserId: user.authUserId, role: user.role, organisationId, organisationStatus, memberId },
  };
}

/** Decides whether a loaded actor may enter an area that requires `required`. */
export function authorize(load: ActorLoad, required: AppRole | "ANY"): Authorization {
  if (load.status === "ANONYMOUS") return { ok: false, reason: "UNAUTHENTICATED" };
  if (load.status === "DISABLED") return { ok: false, reason: "ACCOUNT_DISABLED" };

  const { actor } = load;
  if (required !== "ANY" && actor.role !== required) return { ok: false, reason: "FORBIDDEN" };
  if (actor.role === "ISSUER" && required === "ISSUER" && !actor.organisationId) {
    return { ok: false, reason: "NO_ORGANISATION" };
  }
  // A suspended or not-yet-onboarded organisation keeps no issuer dashboard access.
  if (actor.role === "ISSUER" && required === "ISSUER" && actor.organisationStatus !== "ACTIVE") {
    return { ok: false, reason: "ORGANISATION_INACTIVE" };
  }
  return { ok: true, actor };
}
