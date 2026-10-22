import Link from "next/link";
import { btn, Icon } from "@/components/ui";
import { LogoMark } from "@/components/ui/Logo";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 py-16 text-center">
      <LogoMark className="size-12" />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">This page is not available</h1>
      <p className="mt-2 text-neutral-600">The page does not exist, or it is not shared publicly.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/" className={btn.primary}>
          Go to the home page
        </Link>
        <Link href="/verify" className={btn.secondary}>
          <Icon name="search" className="size-4" />
          Verify a credential
        </Link>
      </div>
    </main>
  );
}
