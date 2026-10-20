"use client";

import Link from "next/link";
import { useActionState, useRef, useState, useTransition } from "react";
import { confirmImportAction, type ImportPreviewState } from "@/app/candidate/actions";
import { Alert, Badge, btn, Card, inputClass } from "@/components/ui";
import type { ImportOutcome, PreviewItem } from "@/server/candidate/import";

type Action = (prev: ImportPreviewState, formData: FormData) => Promise<ImportPreviewState>;

const CATEGORIES = [
  ["EXPERIENCE", "Experience"],
  ["EDUCATION", "Education"],
  ["CERTIFICATION", "Certification / licence"],
  ["MEMBERSHIP", "Membership"],
] as const;
const LIFECYCLES = [
  ["PERMANENT", "Completed"],
  ["CONTINUING", "Current (ongoing)"],
  ["EXPIRING", "Expires on a date"],
] as const;

const MAX_FILE = 200_000;

type Row = PreviewItem & { selected: boolean; confirmed: boolean; errors?: Record<string, string>; note?: string };

export function ImportWorkbench({ preview: previewAction }: { preview: Action }) {
  const [state, formAction, pending] = useActionState<ImportPreviewState, FormData>(previewAction, {});
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  function onFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    if (file.size > MAX_FILE) {
      setFileError("That file is too large. Import a section at a time.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (textRef.current) textRef.current.value = String(reader.result ?? "");
    };
    reader.onerror = () => setFileError("That file could not be read.");
    reader.readAsText(file);
  }

  return (
    <div className="space-y-8">
      <Alert tone="info" title="Nothing is verified during import">
        Imported records are added as self-declared and private. They become verified only when an organisation confirms them from its own records. FARJI does not connect to LinkedIn: you paste text or upload a file that you exported yourself.
      </Alert>

      <form action={formAction} className="max-w-3xl space-y-3" noValidate>
        <div className="space-y-1">
          <label htmlFor="text" className="block text-sm font-medium">
            Paste your professional profile, or choose a CSV file
          </label>
          <textarea id="text" name="text" ref={textRef} rows={10} className={`${inputClass} font-mono`} placeholder={"Experience\nSoftware Engineer\nAcme Ltd · Full-time\nJan 2022 - Present\n\nEducation\nExample University\nBachelor of Technology, Computer Science\n2016 - 2020"} />
          <p className="text-xs text-neutral-500">Use section headings (Experience, Education, Licenses &amp; certifications, Memberships) and a blank line between records. LinkedIn&apos;s own data export CSVs (Positions, Education, Certifications) also work.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className={`${btn.secondary} cursor-pointer`}>
            Choose a file
            <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <button type="submit" disabled={pending} className={btn.primary}>
            {pending ? "Reading…" : "Preview records"}
          </button>
        </div>
        {fileError ? <Alert tone="error">{fileError}</Alert> : null}
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      </form>

      {state.preview ? <PreviewEditor key={state.id} preview={state.preview} /> : null}
    </div>
  );
}

function PreviewEditor({ preview }: { preview: NonNullable<ImportPreviewState["preview"]> }) {
  const [rows, setRows] = useState<Row[]>(() => preview.items.map((i) => ({ ...i, selected: !i.duplicate, confirmed: false })));
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const busy = useRef(false);

  const patch = (key: string, over: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...over } : r)));
  const chosen = rows.filter((r) => r.selected);
  const ready = chosen.length > 0 && chosen.every((r) => r.confirmed);

  function submit() {
    if (busy.current) return; // ignore a double click before the first request settles
    busy.current = true;
    setError(null);
    const payload = JSON.stringify(
      chosen.map((r) => ({
        key: r.key,
        confirmed: r.confirmed,
        category: r.category,
        lifecycleType: r.lifecycleType,
        title: r.title,
        organisationName: r.organisationName,
        startDate: r.startDate,
        endDate: r.lifecycleType === "PERMANENT" ? r.endDate : "",
        expiryDate: r.lifecycleType === "EXPIRING" ? r.expiryDate : "",
        description: r.description,
        location: r.location,
        fieldOfStudy: r.fieldOfStudy,
        credentialNumber: r.credentialNumber,
      })),
    );
    startSubmit(async () => {
      try {
        const res = await confirmImportAction(payload);
        if (res.error) setError(res.error);
        if (res.outcome) {
          setOutcome(res.outcome);
          const byKey = new Map(res.outcome.results.map((x) => [x.key, x]));
          // Created and duplicate records leave the list; invalid ones stay so they can be corrected.
          setRows((rs) =>
            rs
              .filter((r) => {
                const x = byKey.get(r.key);
                return !(x && (x.status === "CREATED" || x.status === "SKIPPED_DUPLICATE"));
              })
              .map((r) => {
                const x = byKey.get(r.key);
                return x && x.status === "INVALID" ? { ...r, errors: x.errors, confirmed: false } : r;
              }),
          );
        }
      } catch {
        setError("Something went wrong. Nothing was lost; please try again.");
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <section className="space-y-4" aria-label="Import preview">
      <h2 className="text-lg font-semibold">Check what was found</h2>
      {preview.warnings.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}
      {outcome ? (
        <Alert tone={outcome.created > 0 ? "success" : "info"} title={`${outcome.created} record${outcome.created === 1 ? "" : "s"} added`}>
          {outcome.skipped > 0 ? `${outcome.skipped} already on your profile were skipped. ` : ""}
          {outcome.invalid > 0 ? `${outcome.invalid} need attention below. ` : ""}
          <Link href="/candidate/claims" className="font-medium underline">
            View your records
          </Link>
        </Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {rows.length === 0 && !outcome ? <p className="text-sm text-neutral-600">No records could be read from that. Try a CSV, add section headings, or add records manually.</p> : null}

      <ul className="space-y-4">
        {rows.map((r) => (
          <RowEditor key={r.key} row={r} onChange={(over) => patch(r.key, over)} onRemove={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
        ))}
      </ul>

      {rows.length > 0 ? (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-neutral-200 bg-neutral-50 py-3">
          <button type="button" className={btn.primary} disabled={!ready || submitting} onClick={submit}>
            {submitting ? "Adding…" : `Add ${chosen.length} selected record${chosen.length === 1 ? "" : "s"}`}
          </button>
          <p className="text-sm text-neutral-600">{ready ? "Nothing is verified during import." : "Select records and tick “I have checked this record” on each."}</p>
        </div>
      ) : null}
    </section>
  );
}

function RowEditor({ row: r, onChange, onRemove }: { row: Row; onChange: (over: Partial<Row>) => void; onRemove: () => void }) {
  const id = (n: string) => `${r.key}-${n}`;
  const text = (name: keyof Row & string, label: string, type = "text") => (
    <div className="space-y-1">
      <label htmlFor={id(name)} className="block text-xs font-medium text-neutral-700">
        {label}
      </label>
      <input id={id(name)} type={type} value={String(r[name] ?? "")} onChange={(e) => onChange({ [name]: e.target.value } as Partial<Row>)} className={inputClass} aria-invalid={r.errors?.[name] ? true : undefined} />
      {r.errors?.[name] ? (
        <p role="alert" className="text-xs text-rose-700">
          {r.errors[name]}
        </p>
      ) : null}
    </div>
  );
  return (
    <Card as="li" className={`space-y-3 ${r.selected ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={r.selected} onChange={(e) => onChange({ selected: e.target.checked })} />
          Add this record
        </label>
        <div className="flex items-center gap-2">
          {r.duplicate ? <Badge tone="attention">Already on your profile</Badge> : null}
          <button type="button" className={btn.link} onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>

      {r.issues.length > 0 ? (
        <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {r.issues.map((i, n) => (
            <li key={n}>
              {i.message}
              {i.raw ? <span className="text-amber-800"> (found: “{i.raw}”)</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={id("category")} className="block text-xs font-medium text-neutral-700">
            Category
          </label>
          <select id={id("category")} value={r.category} onChange={(e) => onChange({ category: e.target.value as Row["category"] })} className={inputClass}>
            <option value="">Choose…</option>
            {CATEGORIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {r.errors?.category ? <p role="alert" className="text-xs text-rose-700">{r.errors.category}</p> : null}
        </div>
        <div className="space-y-1">
          <label htmlFor={id("lifecycleType")} className="block text-xs font-medium text-neutral-700">
            Type of record
          </label>
          <select id={id("lifecycleType")} value={r.lifecycleType} onChange={(e) => onChange({ lifecycleType: e.target.value as Row["lifecycleType"] })} className={inputClass}>
            <option value="">Choose…</option>
            {LIFECYCLES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {r.errors?.lifecycleType ? <p role="alert" className="text-xs text-rose-700">{r.errors.lifecycleType}</p> : null}
        </div>
        {text("title", "Title")}
        {text("organisationName", "Organisation")}
        {text("startDate", "Start date", "date")}
        {r.lifecycleType === "PERMANENT" ? text("endDate", "End date", "date") : null}
        {r.lifecycleType === "EXPIRING" ? text("expiryDate", "Expiry date", "date") : null}
        {text("location", "Location")}
        {r.category === "EDUCATION" ? text("fieldOfStudy", "Field of study") : null}
        {r.category === "CERTIFICATION" ? text("credentialNumber", "Credential number") : null}
      </div>
      {text("description", "Description")}

      {r.matchedOrganisation ? (
        <p className="text-sm text-emerald-800">
          {r.matchedOrganisation.displayName} is available on FARJI, so you will be able to request verification from it. Nothing is linked automatically.
        </p>
      ) : r.organisationName ? (
        <p className="text-sm text-neutral-600">This organisation is not yet available for FARJI verification. You can still keep this record on your profile.</p>
      ) : null}

      <details className="text-xs text-neutral-500">
        <summary className="cursor-pointer">What was read</summary>
        <pre className="mt-1 whitespace-pre-wrap break-words">{r.source}</pre>
      </details>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={r.confirmed} onChange={(e) => onChange({ confirmed: e.target.checked })} />I have checked this record and it is correct
      </label>
    </Card>
  );
}
