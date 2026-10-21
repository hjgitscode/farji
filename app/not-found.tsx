import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">This page is not available</h1>
      <p className="mt-2 text-neutral-700">The page does not exist, or it is not shared publicly.</p>
      <p className="mt-6">
        <Link href="/" className="font-medium underline">
          Go to the home page
        </Link>
      </p>
    </main>
  );
}
