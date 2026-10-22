import { Skeleton } from "@/components/ui";

/** A calm placeholder while a private page loads. It keeps the page's rhythm so nothing jumps when content arrives. */
export function PageSkeleton({ stats = 4 }: { stats?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-7">
      <div className="space-y-2.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: stats }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
