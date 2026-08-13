import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { EntryForm } from "../entry-form";
import { listAccounts } from "@/lib/data/accounts";
import { listCategories } from "@/lib/data/categories";
import { resolveScope } from "@/lib/entities";

export default async function NewEntryPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity: slug } = await params;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  if (scope.kind === "consolidated") {
    return (
      <ConsolidatedNotice
        title="Novo lançamento"
        description="Um lançamento pertence a uma entidade."
        entities={scope.entities}
        path="lancamentos/novo"
      />
    );
  }

  const [accounts, categories] = await Promise.all([
    listAccounts([scope.entity.id]),
    listCategories([scope.entity.id]),
  ]);

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Novo lançamento" description={scope.entity.name} />
        <EmptyState title="Nenhuma conta cadastrada">
          Um lançamento precisa de uma conta. Crie a conta corrente primeiro.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Novo lançamento" description={scope.entity.name} />
      <EntryForm
        slug={slug}
        entry={null}
        accounts={accounts}
        categories={categories}
        counterpartAccountId={null}
      />
    </>
  );
}
