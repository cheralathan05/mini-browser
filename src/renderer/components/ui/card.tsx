import * as React from "react";
import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border border-white/10 bg-card text-card-foreground shadow-soft",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export { Card };
