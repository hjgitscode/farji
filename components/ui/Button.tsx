import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const variantClasses: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-blue-800",
  secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "bg-transparent text-brand hover:bg-blue-50",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
