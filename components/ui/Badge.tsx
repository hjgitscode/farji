import type { HTMLAttributes } from "react";

type Tone = "gray" | "blue" | "green" | "amber" | "red" | "indigo" | "teal" | "purple" | "slate";

const toneClasses: Record<Tone, string> = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-blue-100 text-blue-700",
  green: "bg-green-100 text-green-700",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
  indigo: "bg-indigo-100 text-indigo-700",
  teal: "bg-teal-100 text-teal-700",
  purple: "bg-purple-100 text-purple-700",
  slate: "bg-slate-200 text-slate-700",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = "gray", className = "", ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${toneClasses[tone]} ${className}`}
      {...props}
    />
  );
}
