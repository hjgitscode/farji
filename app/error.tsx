"use client";

import Link from "next/link";

// Last-resort error boundary: a friendly page, never a stack trace or a raw message. (The server logs the real error.)
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-neutral-700">FARJI could not complete that just now. Nothing was changed. Please try again; if it keeps happening, come back a little later.</p>
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" onClick={reset} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
          Try again
        </button>
        <Link href="/" className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium">
          Home
        </Link>
      </div>
    </main>
  );
}
