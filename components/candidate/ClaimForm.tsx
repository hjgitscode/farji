"use client";

import { useActionState } from "react";
import type { ClaimFormState } from "@/app/candidate/actions";

type Values = Partial<Record<string, string>>;

type Props = {
  action: (prev: ClaimFormState, formData: FormData) => Promise<ClaimFormState>;
  submitLabel: string;
  initial?: Values;
  /** When editing, the category is fixed and shown read-only. */
  fixedCategory?: string;
};

const CATEGORIES = [
  ["EXPERIENCE", "Experience"],
  ["EDUCATION", "Education"],
  ["CERTIFICATION", "Certification / licence"],
  ["MEMBERSHIP", "Membership"],
] as const;

const LIFECYCLES = [
  ["PERMANENT", "Completed (permanent record)"],
  ["CONTINUING", "Current (ongoing)"],
  ["EXPIRING", "Expires on a date"],
] as const;

export function ClaimForm({ action, submitLabel, initial = {}, fixedCategory }: Props) {
  const [state, formAction, pending] = useActionState<ClaimFormState, FormData>(action, {});
  const err = (k: string) => state.fieldErrors?.[k];

  const field = (name: string, label: string, opts: { type?: string; required?: boolean; textarea?: boolean } = {}) => (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      {opts.textarea ? (
        <textarea id={name} name={name} defaultValue={initial[name] ?? ""} rows={3} className="w-full rounded border border-neutral-300 px-3 py-2" />
      ) : (
        <input
          id={name}
          name={name}
          type={opts.type ?? "text"}
          defaultValue={initial[name] ?? ""}
          required={opts.required}
          aria-invalid={err(name) ? true : undefined}
          className="w-full rounded border border-neutral-300 px-3 py-2"
        />
      )}
      {err(name) ? (
        <p role="alert" className="text-sm text-red-700">
          {err(name)}
        </p>
      ) : null}
    </div>
  );

  return (
    <form action={formAction} className="max-w-xl space-y-4" noValidate>
      {fixedCategory ? (
        <p className="text-sm text-neutral-700">Category: {CATEGORIES.find(([v]) => v === fixedCategory)?.[1] ?? fixedCategory}</p>
      ) : (
        <div className="space-y-1">
          <label htmlFor="category" className="block text-sm font-medium">
            Category
          </label>
          <select id="category" name="category" defaultValue={initial.category ?? "EXPERIENCE"} className="w-full rounded border border-neutral-300 px-3 py-2">
            {CATEGORIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {err("category") ? <p role="alert" className="text-sm text-red-700">{err("category")}</p> : null}
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor="lifecycleType" className="block text-sm font-medium">
          Type of record
        </label>
        <select id="lifecycleType" name="lifecycleType" defaultValue={initial.lifecycleType ?? "PERMANENT"} className="w-full rounded border border-neutral-300 px-3 py-2">
          {LIFECYCLES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <p className="text-xs text-neutral-600">
          Completed records need an end date. Current records have none. Expiring records need an expiry date.
        </p>
        {err("lifecycleType") ? <p role="alert" className="text-sm text-red-700">{err("lifecycleType")}</p> : null}
      </div>

      {field("title", "Title", { required: true })}
      {field("organisationName", "Organisation (as you would write it)", { required: true })}
      {field("startDate", "Start date", { type: "date", required: true })}
      {field("endDate", "End date (completed records)", { type: "date" })}
      {field("expiryDate", "Expiry date (expiring records)", { type: "date" })}
      {field("location", "Location")}
      {field("fieldOfStudy", "Field of study (education)")}
      {field("credentialNumber", "Credential / licence number (certification)")}
      {field("description", "Description", { textarea: true })}

      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-60">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
