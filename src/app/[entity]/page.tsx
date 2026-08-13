import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { resolveScope } from "@/lib/entities";
import { createClient } from "@/lib/supabase/server";
import { formatTaxId } from "@/lib/tax-id";

type AccountRow = {
  id: string;
  name: string;
  type: string;
  institution: string | null;
  last_digits: string | null;
};

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  bank: "Conta corrente",
  credit_card: "Cartão de crédito",
  cash: "Dinheiro",
  investment: "Aplicação",
};

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity: slug } = await params;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  const entities = scope.kind === "consolidated" ? scope.entities : [scope.entity];

  const supabase = await createClient();
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, type, institution, last_digits, entity_id")
    .in(
      "entity_id",
      entities.map((entity) => entity.id),
    )
    .eq("active", true)
    .order("name");

  return (
    <>
      <PageHeader
        title="Visão geral"
        description={
          scope.kind === "consolidated"
            ? "As duas entidades somadas, com coluna por entidade nos relatórios."
            : scope.entity.legalName
        }
      />

      <section className="mb-8 grid gap-4 sm:grid-cols-2">
        {entities.map((entity) => (
          <div key={entity.id} className="rounded-lg border border-border p-4">
            <p className="text-sm font-medium">{entity.name}</p>
            <p className="mt-1 text-xs text-muted">{entity.legalName}</p>
            <p className="tabular mt-2 text-xs text-muted">
              CNPJ {formatTaxId(entity.taxId)}
            </p>
          </div>
        ))}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium">Contas</h2>
        {accounts && accounts.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(accounts as AccountRow[]).map((account) => (
              <li key={account.id} className="flex items-baseline justify-between px-4 py-3">
                <span className="text-sm">{account.name}</span>
                <span className="text-xs text-muted">
                  {ACCOUNT_TYPE_LABEL[account.type] ?? account.type}
                  {account.last_digits ? ` · final ${account.last_digits}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nenhuma conta cadastrada" phase="Fase 1">
            Rode <code className="font-mono">npm run db:seed</code> para criar as
            entidades e as contas do Itaú.
          </EmptyState>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium">Indicadores</h2>
        <EmptyState title="Ainda não construído" phase="Fase 8">
          Os indicadores dependem do fluxo de caixa (Fase 2) e do DRE (Fase 6).
        </EmptyState>
      </section>
    </>
  );
}
