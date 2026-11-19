import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router";

export type Variant = "primary" | "teal" | "secondary" | "ghost" | "ghost-light" | "outline-light";
export type Size = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition duration-200 select-none " +
  "hover:-translate-y-px active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-800 text-white shadow-[var(--shadow-card)] hover:bg-brand-700 hover:shadow-[var(--shadow-lift)]",
  teal: "bg-brand-teal text-brand-950 shadow-[var(--shadow-glow)] hover:bg-brand-teal-light",
  secondary: "bg-white text-brand-800 ring-1 ring-line shadow-[var(--shadow-card)] hover:ring-brand-300",
  ghost: "text-brand-800 hover:bg-brand-50",
  "ghost-light": "text-white/90 hover:bg-white/10 hover:text-white",
  "outline-light": "text-white ring-1 ring-white/30 hover:bg-white/10 hover:ring-white/50",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-13 px-6 text-base",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = ""): string {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; children: ReactNode };

export default function Button({ variant = "primary", size = "md", className = "", children, ...rest }: BtnProps) {
  return (
    <button className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

type LinkBtnProps = LinkProps & { variant?: Variant; size?: Size };

export function LinkButton({ variant = "primary", size = "md", className = "", ...rest }: LinkBtnProps) {
  return <Link className={buttonClass(variant, size, className as string)} {...rest} />;
}
