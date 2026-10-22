import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div role="status" aria-label="Checking credential" className="mx-auto max-w-3xl space-y-6">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-52 rounded-2xl" />
      <Skeleton className="h-40 rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
      <span className="sr-only">Checking credential…</span>
    </div>
  );
}
