import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "secondary" | "destructive" | "warning" | "success" | "outline" | "info";

const VARIANTS: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground",
  secondary: "bg-muted text-foreground",
  destructive: "bg-destructive text-destructive-foreground",
  warning: "bg-warning text-warning-foreground",
  success: "bg-success text-success-foreground",
  outline: "border border-border text-foreground",
  info: "bg-info text-info-foreground",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
