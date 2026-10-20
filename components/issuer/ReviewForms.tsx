"use client";

import { useActionState } from "react";
import type { ReviewFormState } from "@/app/issuer/actions";
import { REJECTION_REASONS, REJECTION_REASON_LABEL } from "@/lib/core/review";

type Action = (prev: ReviewFormState, formData: FormData) => Promise<ReviewFormState>;

function Fields({ state, idPrefix }: { state: ReviewFormState; idPrefix: string }) {
  const err = (k: string) => state.fieldErrors?.[k];
  return (
    <>
      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-sourceOfTruthReference`} className="block text-sm font-medium">
          Reference to your own record (optional, internal)
        </label>
        <input
          id={`${idPrefix}-sourceOfTruthReference`}
          name="sourceOfTruthReference"
          type="text"
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
        />
        {err("sourceOfTruthReference") ? <p role="alert" className="text-sm text-rose-700">{err("sourceOfTruthReference")}</p> : null}
      </div>
      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-notes`} className="block text-sm font-medium">
          Review notes (optional, internal)
        </label>
        <textarea id={`${idPrefix}-notes`} name="notes" rows={2} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900" />
        {err("notes") ? <p role="alert" className="text-sm text-rose-700">{err("notes")}</p> : null}
      </div>
    </>
  );
}

export function ApproveForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState<ReviewFormState, FormData>(action, {});
  return (
    <form action={formAction} className="max-w-xl space-y-3" noValidate>
      <h3 className="font-medium">Approve</h3>
      <Fields state={state} idPrefix="approve" />
      {state.error ? <p role="alert" className="text-sm text-rose-700">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="inline-flex items-center justify-center rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
        {pending ? "Approving…" : "Approve request"}
      </button>
    </form>
  );
}

export function RejectForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState<ReviewFormState, FormData>(action, {});
  return (
    <form action={formAction} className="max-w-xl space-y-3" noValidate>
      <h3 className="font-medium">Reject</h3>
      <div className="space-y-1">
        <label htmlFor="reject-rejectionReason" className="block text-sm font-medium">
          Reason
        </label>
        <select id="reject-rejectionReason" name="rejectionReason" className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900" defaultValue="">
          <option value="" disabled>
            Choose a reason
          </option>
          {REJECTION_REASONS.map((r) => (
            <option key={r} value={r}>
              {REJECTION_REASON_LABEL[r]}
            </option>
          ))}
        </select>
        {state.fieldErrors?.rejectionReason ? <p role="alert" className="text-sm text-rose-700">{state.fieldErrors.rejectionReason}</p> : null}
      </div>
      <Fields state={state} idPrefix="reject" />
      {state.error ? <p role="alert" className="text-sm text-rose-700">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="inline-flex items-center justify-center rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
        {pending ? "Rejecting…" : "Reject request"}
      </button>
    </form>
  );
}
