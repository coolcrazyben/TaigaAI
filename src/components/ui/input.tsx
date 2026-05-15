import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition focus:border-emerald-500",
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";
