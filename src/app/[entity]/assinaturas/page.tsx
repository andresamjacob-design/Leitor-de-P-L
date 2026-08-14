import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { ExportLinks } from "@/components/export-links";
import { PageHeader } from "@/components/page-header";
import { Table, TableScroll, Td, Th } from "@/components/ui/table";
import { listAccounts } from "@/lib/data/accounts";
import { listCategories } from "@/lib/data/categories";
import { listCashEntries } from "@/lib/data/cash-entries";
import { detectRecurring, totalMonthly } from "@/lib/categorize/recurrence";
import { resolveScope } from "@/lib/entities";
import { formatPtBRDate, todayInSaoPaulo } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

const CADENCE_LABEL: Record<string, string> = { mensal: "Mensal", anual: "Anual" };

export default async function SubscriptionsPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity: slug } = await params;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  const entities = scope.kind === "consolidated" ? scope.entities : [scope.entity];
  const entityIds = entities.map((entity) => entity.id);

  const [entries, categories, accounts] = await Promise.all([
    listCashEntries({ entityIds, direction: "out", limit: 20000 }),
    listCategories(entityIds, { includeInactive: true }),
    listAccounts(entityIds, { includeInactive: true }),
  ]);

  const recurrences = detectRecurring(
    entries.map((entry) => ({
      id: entry.id,
      description: entry.description,
      amount: entry.amount,
      occurredOn: entry.occurredOn,
      categoryId: entry.categoryId,
      accountId: entry.accountId,
    })),
    { today: todayInSaoPaulo() },
  );

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const active = recurrences.filter((recurrence) => recurrence.active);

  return (
    <>
      <PageHeader
        title="Assinaturas"
        description="O que é cobrado de novo todo mês, reconstruído dos lançamentos — ninguém precisa manter esta lista."
      />

      <div className="mb-6 flex justify-end">
        <ExportLinks slug={slug} report="assinaturas" />
      </div>

      {recurrences.length === 0 ? (
        <EmptyState title="Nenhuma cobrança recorrente encontrada">
          É preciso pelo menos três cobranças do mesmo fornecedor, em intervalo parecido e
          com valor parecido. Importe alguns meses de fatura e elas aparecem sozinhas.
        </EmptyState>
      ) : (
        <>
          <dl className="mb-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted">Ativas</dt>
              <dd className="tabular">
                {active.length}
                {active.length === recurrences.length ? null : (
                  <span className="ml-2 text-xs text-muted">
                    de {recurrences.length} encontradas
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Custo mensal</dt>
              <dd className="tabular">{formatMoney(totalMonthly(recurrences))}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Anualizado</dt>
              <dd className="tabular">{formatMoney(totalMonthly(recurrences) * 12n)}</dd>
            </div>
          </dl>

          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>Fornecedor</Th>
                  <Th>Categoria</Th>
                  <Th>Conta</Th>
                  <Th className="w-20">Cadência</Th>
                  <Th numeric className="w-20">
                    Cobranças
                  </Th>
                  <Th className="w-28">Última</Th>
                  <Th numeric className="w-28">
                    Por mês
                  </Th>
                  <Th numeric className="w-28">
                    Por ano
                  </Th>
                </tr>
              </thead>
              <tbody>
                {recurrences.map((recurrence) => {
                  const stale = !recurrence.active;
                  return (
                    <tr key={`${recurrence.key}-${recurrence.accountId}`} className={stale ? "opacity-60" : ""}>
                      <Td>
                        <Link
                          href={`/${slug}/lancamentos?busca=${encodeURIComponent(recurrence.key)}`}
                          className="text-accent hover:underline"
                        >
                          {recurrence.label}
                        </Link>
                        {stale ? (
                          <span className="ml-2 text-xs text-muted">encerrada</span>
                        ) : null}
                      </Td>
                      <Td className="text-xs text-muted">
                        {recurrence.categoryId
                          ? (categoryById.get(recurrence.categoryId)?.name ?? "—")
                          : "Sem categoria"}
                      </Td>
                      <Td className="text-xs text-muted">
                        {accountById.get(recurrence.accountId)?.name ?? "—"}
                      </Td>
                      <Td className="text-xs">
                        {CADENCE_LABEL[recurrence.cadence] ?? recurrence.cadence}
                      </Td>
                      <Td numeric className="text-xs text-muted">
                        {recurrence.occurrences}
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-muted tabular">
                        {formatPtBRDate(recurrence.lastCharge)}
                      </Td>
                      <Td numeric>{formatMoney(recurrence.monthlyCost)}</Td>
                      <Td numeric className="text-muted">
                        {formatMoney(recurrence.annualCost)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableScroll>
        </>
      )}

      <p className="mt-6 text-xs text-muted">
        Uma cobrança entra nesta lista com três ocorrências do mesmo fornecedor, em
        intervalo parecido e valor parecido — uma compra grande no meio não conta. O custo
        mensal de uma assinatura anual é o valor dividido por doze, para que os dois possam
        ser somados na mesma coluna. Uma assinatura sem cobrança há dois ciclos entra como
        <strong> encerrada</strong> e sai do total — ou ela parou, ou o fornecedor mudou o
        jeito de escrever o nome, e nos dois casos somá-la inflaria o número.
      </p>
    </>
  );
}
