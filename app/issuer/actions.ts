"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireIssuer } from "@/lib/auth/guards";
import { getDb } from "@/lib/database/client";
import { DomainError } from "@/server/candidate/errors";
import { approveVerificationRequest, rejectVerificationRequest } from "@/server/issuer/review";

// Thin Server Actions: authenticate the issuer (Phase 3 guard), read an ALLOWLIST of form
// fields, call the service, translate the result. The issuer, member and organisation always
// come from the guard; no organisation, member, key or candidate value is read from the form.

export type ReviewFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

const REVIEW_FIELDS = ["notes", "sourceOfTruthReference", "rejectionReason"] as const;

function reviewInput(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of REVIEW_FIELDS) {
    const v = formData.get(key);
    if (typeof v === "string") out[key] = v;
  }
  return out;
}

function toState(e: unknown): ReviewFormState {
  if (e instanceof DomainError) return { error: e.message, fieldErrors: e.fieldErrors };
  return { error: "Something went wrong. Please try again." };
}

export async function approveRequestAction(requestId: string, _prev: ReviewFormState, formData: FormData): Promise<ReviewFormState> {
  const actor = await requireIssuer("/issuer/requests");
  try {
    await approveVerificationRequest(getDb(), actor, requestId, reviewInput(formData));
  } catch (e) {
    return toState(e);
  }
  revalidatePath("/issuer/requests");
  redirect(`/issuer/requests/${requestId}`);
}

export async function rejectRequestAction(requestId: string, _prev: ReviewFormState, formData: FormData): Promise<ReviewFormState> {
  const actor = await requireIssuer("/issuer/requests");
  try {
    await rejectVerificationRequest(getDb(), actor, requestId, reviewInput(formData));
  } catch (e) {
    return toState(e);
  }
  revalidatePath("/issuer/requests");
  redirect(`/issuer/requests/${requestId}`);
}
