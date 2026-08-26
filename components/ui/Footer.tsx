import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>NotSoFarji — because your resume should not be farji.</p>
        <p>
          Innovative Design Project ·{" "}
          <Link href="/developers" className="text-brand hover:underline">
            Developers
          </Link>
        </p>
      </div>
    </footer>
  );
}
