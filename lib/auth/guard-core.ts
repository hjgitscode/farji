import { authorize, type Actor, type ActorLoad, type DenyReason } from "./authorize";
import { loginUrlFor, type AppRole } from "./paths";

// Redirect targets for each denial. Messages shown on /access-denied are fixed text
// chosen by a whitelisted reason code; nothing internal is echoed back.
export function denialPath(reason: DenyReason, nextPath?: string | null): string {
  switch (reason) {
    case "UNAUTHENTICATED":
      return loginUrlFor(nextPath);
    case "ACCOUNT_DISABLED":
      return "/access-denied?reason=disabled";
    case "NO_ORGANISATION":
      return "/access-denied?reason=organisation";
    case "ORGANISATION_INACTIVE":
      return "/access-denied?reason=organisation_inactive";
    case "FORBIDDEN":
      return "/access-denied";
  }
}

/**
 * Builds the guard functions around a loader and a redirect function (Next's
 * `redirect`, which throws). Injecting both keeps the guard logic unit-testable.
 */
export function createGuards(loadCurrentActor: () => Promise<ActorLoad>, redirect: (path: string) => never) {
  async function requireRole(required: AppRole | "ANY", nextPath?: string | null): Promise<Actor> {
    const decision = authorize(await loadCurrentActor(), required);
    if (!decision.ok) redirect(denialPath(decision.reason, nextPath));
    return decision.actor;
  }

  return {
    /** Any signed-in, active FARJI user (any role). */
    requireAuthenticatedUser: (nextPath?: string | null) => requireRole("ANY", nextPath),
    requireCandidate: (nextPath?: string | null) => requireRole("CANDIDATE", nextPath),
    /** ISSUER role AND an ACTIVE OrganisationMember; actor.organisationId is server-derived. */
    requireIssuer: (nextPath?: string | null) => requireRole("ISSUER", nextPath),
    requireAdmin: (nextPath?: string | null) => requireRole("ADMIN", nextPath),
  };
}
