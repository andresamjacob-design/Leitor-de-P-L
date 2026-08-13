import * as React from "react";
import { cn } from "@/lib/utils";

/** A table that scrolls sideways instead of pushing the page wider than the window. */
export function TableScroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      {children}
    </div>
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-sm", className)} {...props} />;
}

export function Th({
  className,
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope={props.scope ?? "col"}
      className={cn(
        "whitespace-nowrap border-b border-border px-3 py-2 text-xs font-medium text-muted",
        numeric ? "text-right tabular" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "border-b border-border px-3 py-2",
        numeric ? "whitespace-nowrap text-right tabular" : "",
        className,
      )}
      {...props}
    />
  );
}

/** A negative number reads faster in red than with a minus sign alone. */
export function Amount({
  value,
  format,
  className,
}: {
  value: bigint;
  format: (value: bigint) => string;
  className?: string;
}) {
  return (
    <span className={cn(value < 0n ? "text-red-600 dark:text-red-400" : "", className)}>
      {format(value)}
    </span>
  );
}
