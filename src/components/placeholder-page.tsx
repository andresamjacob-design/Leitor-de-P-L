import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

/**
 * A screen whose data layer is not built yet. It renders nothing that looks like a
 * number, on purpose (SPEC §14).
 */
export function PlaceholderPage({
  title,
  description,
  phase,
  waitingFor,
}: {
  title: string;
  description: string;
  phase: string;
  waitingFor: string;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState title="Ainda não construído" phase={phase}>
        {waitingFor}
      </EmptyState>
    </>
  );
}
