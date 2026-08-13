import type { ReactNode } from "react";

/**
 * The honest empty state. SPEC §14: nothing that is not built yet may render fake data —
 * it says what it is, which phase builds it, and nothing more.
 */
export function EmptyState({
  title,
  phase,
  children,
}: {
  title: string;
  phase?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {children ? <p className="mt-2 text-sm text-muted">{children}</p> : null}
      {phase ? (
        <p className="mt-4 inline-block rounded-full border border-border px-3 py-1 text-xs text-muted">
          {phase}
        </p>
      ) : null}
    </div>
  );
}
