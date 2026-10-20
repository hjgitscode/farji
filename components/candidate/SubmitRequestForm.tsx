"use client";

import { useActionState } from "react";
import type { ClaimFormState } from "@/app/candidate/actions";

type Props = {
  action: (prev: ClaimFormState, formData: FormData) => Promise<ClaimFormState>;
  claimVersionId: string;
  organisations: { id: string; displayName: string }[];
};

export function SubmitRequestForm({ action, claimVersionId, organisations }: Props) {
  const [state, formAction, pending] = useActionState<ClaimFormState, FormData>(action, {});
  const err = (k: string) => state.fieldErrors?.[k];

  if (organisations.length === 0) {
    return <p className="text-sm text-neutral-700">No organisations are available to receive requests yet.</p>;
  }

  return (
    <form action={formAction} className="max-w-xl space-y-3" noValidate>
      <input type="hidden" name="claimVersionId" value={claimVersionId} />

      <div className="space-y-1">
        <label htmlFor="organisationId" className="block text-sm font-medium">
          Organisation to verify this record
        </label>
        <select id="organisationId" name="organisationId" required className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900">
          {organisations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.displayName}
            </option>
          ))}
        </select>
        {err("organisationId") ? <p role="alert" className="text-sm text-rose-700">{err("organisationId")}</p> : null}
      </div>

      <div className="space-y-1">
        <label htmlFor="institutionalIdentifier" className="block text-sm font-medium">
          Your identifier at that organisation (optional)
        </label>
        <input id="institutionalIdentifier" name="institutionalIdentifier" type="text" className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900" />
        {err("institutionalIdentifier") ? <p role="alert" className="text-sm text-rose-700">{err("institutionalIdentifier")}</p> : null}
      </div>

      <div className="space-y-1">
        <label htmlFor="candidateNote" className="block text-sm font-medium">
          Note for the reviewer (optional)
        </label>
        <textarea id="candidateNote" name="candidateNote" rows={2} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900" />
        {err("candidateNote") ? <p role="alert" className="text-sm text-rose-700">{err("candidateNote")}</p> : null}
      </div>

      {state.error ? <p role="alert" className="text-sm text-rose-700">{state.error}</p> : null}
      {state.message ? <p role="status" className="text-sm text-emerald-800">{state.message}</p> : null}

      <button type="submit" disabled={pending} className="inline-flex items-center justify-center rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
        {pending ? "Submitting…" : "Request verification"}
      </button>
    </form>
  );
}
