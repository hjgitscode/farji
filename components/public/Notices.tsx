import { Alert, EmptyState } from "@/components/ui";

export function TooManyRequests() {
  return (
    <div className="mx-auto max-w-xl py-8">
      <Alert tone="warning" title="Please slow down">
        There have been a lot of requests from your connection. Wait a minute and try again.
      </Alert>
    </div>
  );
}

export function VerificationUnavailable() {
  return (
    <div className="mx-auto max-w-xl py-8">
      <EmptyState title="Verification is temporarily unavailable">We cannot check records right now. Nothing is being shown as verified. Please try again later.</EmptyState>
    </div>
  );
}
