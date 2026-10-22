"use client";

import { useActionState } from "react";
import type { ReviewFormState } from "@/app/issuer/actions";
import { btn, Icon, inputClass, Spinner } from "@/components/ui";
import { REJECTION_REASONS, REJECTION_REASON_LABEL } from "@/lib/core/review";

type Action = (prev: ReviewFormState, formData: FormData) => Promise<ReviewFormState>;

function Fields({ state, idPrefix }: { state: ReviewFormState; idPrefix: string }) {
  const err = (k: string) => state.fieldErrors?.[k];
  return (
    <>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-sourceOfTruthReference`} className="block text-sm font-medium text-neutral-800">
          Reference to your own record <span className="font-normal text-neutral-500">(optional, internal)</span>
        </label>
        <input id={`${idPrefix}-sourceOfTruthReference`} name="sourceOfTruthReference" type="text" className={inputClass} />
        {err("sourceOfTruthReference") ? (
          <p role="alert" className="text-sm text-rose-700">
            {err("sourceOfTruthReference")}
          </p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-notes`} className="block text-sm font-medium text-neutral-800">
          Review notes <span className="font-normal text-neutral-500">(optional, internal)</span>
        </label>
        <textarea id={`${idPrefix}-notes`} name="notes" rows={2} className={inputClass} />
        {err("notes") ? (
          <p role="alert" className="text-sm text-rose-700">
            {err("notes")}
          </p>
        ) : null}
      </div>
    </>
  );
}

function FormError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="flex items-start gap-1.5 text-sm text-rose-700">
      <Icon name="alert" className="mt-0.5 size-4" strokeWidth={2.25} />
      {message}
    </p>
  ) : null;
}

export function ApproveForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState<ReviewFormState, FormData>(action, {});
  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 sm:p-5" noValidate>
      <div>
        <h3 className="flex items-center gap-2 font-semibold text-emerald-900">
          <Icon name="check" className="size-4" strokeWidth={2.5} />
          Approve
        </h3>
        <p className="mt-0.5 text-sm text-neutral-600">Creates a credential for you to sign next.</p>
      </div>
      <Fields state={state} idPrefix="approve" />
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={`${btn.primary} w-full sm:w-auto`}>
        {pending ? (
          <>
            <Spinner />
            Approving…
          </>
        ) : (
          "Approve request"
        )}
      </button>
    </form>
  );
}

export function RejectForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState<ReviewFormState, FormData>(action, {});
  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 sm:p-5" noValidate>
      <div>
        <h3 className="flex items-center gap-2 font-semibold text-neutral-900">
          <Icon name="x" className="size-4" strokeWidth={2.5} />
          Reject
        </h3>
        <p className="mt-0.5 text-sm text-neutral-600">Keeps the request on file. The record stays the candidate&apos;s, as self-declared.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="reject-rejectionReason" className="block text-sm font-medium text-neutral-800">
          Reason
        </label>
        <select id="reject-rejectionReason" name="rejectionReason" className={inputClass} defaultValue="">
          <option value="" disabled>
            Choose a reason
          </option>
          {REJECTION_REASONS.map((r) => (
            <option key={r} value={r}>
              {REJECTION_REASON_LABEL[r]}
            </option>
          ))}
        </select>
        {state.fieldErrors?.rejectionReason ? (
          <p role="alert" className="text-sm text-rose-700">
            {state.fieldErrors.rejectionReason}
          </p>
        ) : null}
      </div>
      <Fields state={state} idPrefix="reject" />
      <FormError message={state.error} />
      <button type="submit" disabled={pending} className={`${btn.secondary} w-full border-rose-300 text-rose-800 hover:border-rose-400 hover:bg-rose-50 sm:w-auto`}>
        {pending ? (
          <>
            <Spinner />
            Rejecting…
          </>
        ) : (
          "Reject request"
        )}
      </button>
    </form>
  );
}
