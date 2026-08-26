interface PageHeaderProps {
  title: string;
  subtitle?: string;
}

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h1>
      {subtitle && <p className="mt-2 max-w-2xl text-slate-600">{subtitle}</p>}
    </div>
  );
}
