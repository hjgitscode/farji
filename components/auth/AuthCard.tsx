import { Icon, type IconName } from "@/components/ui";

/** The centred card every sign-in style page shares. */
export function AuthCard({ title, description, icon = "lock", children, footer }: { title: string; description?: React.ReactNode; icon?: IconName; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md py-4 sm:py-10">
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-lift sm:p-8">
        <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
          <Icon name={icon} className="size-5" />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1.5 text-sm leading-relaxed text-neutral-600">{description}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
      {footer ? <p className="mt-5 text-center text-sm text-neutral-600">{footer}</p> : null}
    </div>
  );
}
