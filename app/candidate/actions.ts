"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCandidate } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { DomainError } from "@/server/candidate/errors";
import { createClaim, submitVerificationRequest, updateClaim, withdrawVerificationRequest } from "@/server/candidate/claims";
import { confirmImport, previewImport, type ImportOutcome, type ImportPreview } from "@/server/candidate/import";
import { saveProfile, setClaimVisibility } from "@/server/candidate/profile";

// Thin Server Actions: authenticate the candidate (Phase 3 guard), read an ALLOWLIST of
// form fields, call the service, translate the result. The candidate identity always comes
// from the guard; no user id, role or organisation-member value is ever read from the form.

export type ClaimFormState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
};

const CLAIM_FIELDS = [
  "category",
  "lifecycleType",
  "title",
  "organisationName",
  "description",
  "location",
  "fieldOfStudy",
  "credentialNumber",
  "startDate",
  "endDate",
  "expiryDate",
] as const;

function claimInput(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of CLAIM_FIELDS) {
    const v = formData.get(key);
    if (typeof v === "string") out[key] = v;
  }
  return out;
}

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

function toState(e: unknown): ClaimFormState {
  if (e instanceof DomainError) return { error: e.message, fieldErrors: e.fieldErrors };
  return { error: "Something went wrong. Please try again." };
}

export async function createClaimAction(_prev: ClaimFormState, formData: FormData): Promise<ClaimFormState> {
  const actor = await requireCandidate("/candidate/claims/new");
  let claimId: string;
  try {
    ({ claimId } = await createClaim(getDb(), actor, claimInput(formData)));
  } catch (e) {
    return toState(e);
  }
  revalidatePath("/candidate/claims");
  redirect(`/candidate/claims/${claimId}`);
}

export async function updateClaimAction(claimId: string, _prev: ClaimFormState, formData: FormData): Promise<ClaimFormState> {
  const actor = await requireCandidate("/candidate/claims");
  try {
    await updateClaim(getDb(), actor, claimId, claimInput(formData));
  } catch (e) {
    return toState(e);
  }
  revalidatePath("/candidate/claims");
  redirect(`/candidate/claims/${claimId}`);
}

export async function submitRequestAction(claimId: string, _prev: ClaimFormState, formData: FormData): Promise<ClaimFormState> {
  const actor = await requireCandidate("/candidate/claims");
  try {
    await submitVerificationRequest(getDb(), actor, {
      claimId,
      claimVersionId: text(formData, "claimVersionId"),
      organisationId: text(formData, "organisationId"),
      institutionalIdentifier: text(formData, "institutionalIdentifier"),
      candidateNote: text(formData, "candidateNote"),
    });
  } catch (e) {
    return toState(e);
  }
  revalidatePath(`/candidate/claims/${claimId}`);
  return { message: "Verification request submitted." };
}

export async function withdrawRequestAction(requestId: string): Promise<void> {
  const actor = await requireCandidate("/candidate/claims");
  try {
    await withdrawVerificationRequest(getDb(), actor, requestId);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    // Not found / no longer open: fall through to the refreshed list.
  }
  revalidatePath("/candidate/claims");
  redirect("/candidate/claims");
}

// ───────────────────────────── profile, visibility, import (Phase 11) ─────────────────────────────

export type ProfileFormState = ClaimFormState & { saved?: boolean };

const PROFILE_FIELDS = ["handle", "displayName", "headline", "about", "location", "visibility"] as const;

export async function saveProfileAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const actor = await requireCandidate("/candidate/profile");
  const input: Record<string, unknown> = {};
  for (const k of PROFILE_FIELDS) input[k] = text(formData, k);
  try {
    await saveProfile(getDb(), actor, input);
  } catch (e) {
    return toState(e);
  }
  revalidatePath("/candidate/profile");
  return { saved: true, message: "Profile saved." };
}

/** Sets who can see one of the candidate's OWN records. The claim id is checked against `actor.userId` in the service. */
export async function setVisibilityAction(claimId: string, formData: FormData): Promise<void> {
  const actor = await requireCandidate("/candidate/claims");
  try {
    await setClaimVisibility(getDb(), actor, claimId, text(formData, "visibility"));
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
  }
  revalidatePath(`/candidate/claims/${claimId}`);
  revalidatePath("/candidate/claims");
}

export type ImportPreviewState = { error?: string; preview?: ImportPreview; id?: string };

/** Parses and previews. Persists nothing. */
export async function previewImportAction(_prev: ImportPreviewState, formData: FormData): Promise<ImportPreviewState> {
  const actor = await requireCandidate("/candidate/import");
  try {
    return { preview: await previewImport(getDb(), actor, text(formData, "text")), id: String(Date.now()) };
  } catch (e) {
    return { error: e instanceof DomainError ? e.message : "We could not read that. Check the text or file and try again." };
  }
}

export type ImportConfirmResult = { error?: string; outcome?: ImportOutcome };

/** Creates SELF_DECLARED claims for the confirmed items through the Phase 4 service. The payload is parsed defensively. */
export async function confirmImportAction(payload: string): Promise<ImportConfirmResult> {
  const actor = await requireCandidate("/candidate/import");
  let items: unknown;
  try {
    if (typeof payload !== "string" || payload.length > 400_000) throw new Error("too large");
    items = JSON.parse(payload);
  } catch {
    return { error: "That import could not be read. Start again." };
  }
  try {
    const outcome = await confirmImport(getDb(), actor, items);
    revalidatePath("/candidate/claims");
    revalidatePath("/candidate");
    return { outcome };
  } catch (e) {
    return { error: e instanceof DomainError ? e.message : "Something went wrong. Nothing was lost; please try again." };
  }
}
