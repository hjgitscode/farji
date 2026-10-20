"use client";

import { useActionState } from "react";
import type { ProfileFormState } from "@/app/candidate/actions";
import { Alert, btn, inputClass } from "@/components/ui";

type Initial = { handle?: string; displayName?: string; headline?: string | null; about?: string | null; location?: string | null; visibility?: string };

export function ProfileForm({ action, initial }: { action: (prev: ProfileFormState, formData: FormData) => Promise<ProfileFormState>; initial: Initial }) {
  const [state, formAction, pending] = useActionState<ProfileFormState, FormData>(action, {});
  const err = (k: string) => state.fieldErrors?.[k];
  const row = (name: string, label: string, opts: { textarea?: boolean; help?: string; value?: string | null } = {}) => (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      {opts.textarea ? (
        <textarea id={name} name={name} rows={4} defaultValue={opts.value ?? ""} className={inputClass} aria-invalid={err(name) ? true : undefined} />
      ) : (
        <input id={name} name={name} type="text" defaultValue={opts.value ?? ""} className={inputClass} aria-invalid={err(name) ? true : undefined} />
      )}
      {opts.help ? <p className="text-xs text-neutral-500">{opts.help}</p> : null}
      {err(name) ? (
        <p role="alert" className="text-sm text-rose-700">
          {err(name)}
        </p>
      ) : null}
    </div>
  );
  return (
    <form action={formAction} className="max-w-xl space-y-4" noValidate>
      {row("displayName", "Your name", { value: initial.displayName })}
      {row("handle", "Profile name (used in your link)", { value: initial.handle, help: "3 to 40 lowercase letters, numbers or hyphens. Example: priya-sharma" })}
      {row("headline", "Headline", { value: initial.headline })}
      {row("location", "Location", { value: initial.location })}
      {row("about", "About", { textarea: true, value: initial.about })}
      <div className="space-y-1">
        <label htmlFor="visibility" className="block text-sm font-medium">
          Who can open your profile page
        </label>
        <select id="visibility" name="visibility" defaultValue={initial.visibility ?? "PRIVATE"} className={inputClass}>
          <option value="PRIVATE">Only me (private)</option>
          <option value="UNLISTED">Anyone with the link (not indexed by search engines)</option>
          <option value="PUBLIC">Public</option>
        </select>
        <p className="text-xs text-neutral-500">Records are shared separately: only records you mark &ldquo;On my public profile&rdquo; are ever listed.</p>
        {err("visibility") ? (
          <p role="alert" className="text-sm text-rose-700">
            {err("visibility")}
          </p>
        ) : null}
      </div>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
      <button type="submit" disabled={pending} className={btn.primary}>
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
