import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { ExportLinks } from "@/components/export-links";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Amount, Table, TableScroll, Td, Th } from "@/components/ui/table";
import { loadCashFlow } from "@/lib/data/cash-flow-report";
import { resolveScope } from "@/lib/entities";
import { daysInMonth, formatPeriodShort, todayInSaoPaulo } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { CashFlowRow, CashFlowSection } from "@/lib/cash-flow";

type Search = { de?: string; ate?: string };

function monthEnd(period: string): string {
  return `${period.slice(0, 8)}${String(daysInMonth(period)).padStart(2, "0")}`;
}

export default async function CashFlowPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<Search>;
}) {
  const { entity: slug } = await params;
  const search = await searchParams;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  const entities = scope.kind === "consolidated" ? scope.entities : [scope.entity];
  const year = todayInSaoPaulo().slice(0, 4);

  const from = /^\d{4}-\d{2}$/.test(search.de ?? "") ? `${search.de}-01` : `${year}-01-01`;
  const toMonth = /^\d{4}-\d{2}$/.test(search.ate ?? "") ? `${search.ate}-01` : `${year}-12-01`;
  const to = monthEnd(toMonth);

  const { report, cashAccounts, cardAccounts } = await loadCashFlow({
    entityIds: entities.map((entity) => entity.id),
    from,
    to,
  });

  const { periods } = report;

  // "Até" antes de "De" não é um relatório vazio, é um pedido impossível — dizer isso é
  // melhor do que devolver uma tabela sem colunas (SPEC §14).
  const rangeForm = (
    <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
      <Field label="De" htmlFor="de">
        <Input id="de" name="de" type="month" defaultValue={from.slice(0, 7)} />
      </Field>
      <Field label="Até" htmlFor="ate">
        <Input id="ate" name="ate" type="month" defaultValue={toMonth.slice(0, 7)} />
      </Field>
      <Button type="submit" variant="outline" size="sm">
        Aplicar
      </Button>
    </form>
  );

  if (periods.length === 0) {
    return (
      <>
        <PageHeader title="Fluxo de caixa" description="Regime de caixa." />
        {rangeForm}
        <EmptyState title="Intervalo inválido">
          O mês final vem antes do inicial. Ajuste o filtro e tente de novo.
        </EmptyState>
      </>
    );
  }

  const [inflow, outflow, transfers] = report.sections as [
    CashFlowSection,
    CashFlowSection,
    CashFlowSection,
  ];

  /** Any cell in the matrix can be opened as the entries that make it up. */
  function drillDown(period: string, row: CashFlowRow | null): string {
    const query = new URLSearchParams({ de: period, ate: monthEnd(period) });
    if (row) query.set("categoria", row.categoryId ?? "none");
    return `/${slug}/lancamentos?${query.toString()}`;
  }

  function sectionRows(section: CashFlowSection, label: string) {
    if (section.rows.length === 0) return null;

    return (
      <>
        <tr>
          <Th
            scope="colgroup"
            colSpan={periods.length + 2}
            className="bg-surface text-xs uppercase tracking-wide"
          >
            {label}
          </Th>
        </tr>
        {section.rows.map((row) => (
          <tr key={`${section.key}-${row.categoryId ?? "none"}`}>
            <Td className="whitespace-nowrap">
              <span className="text-xs text-muted tabular">{row.code ?? "—"}</span>{" "}
              {row.label}
            </Td>
            {row.values.map((value, index) => (
              <Td key={periods[index]} numeric>
                {value === 0n ? (
                  <span className="text-muted">—</span>
                ) : (
                  <Link
                    href={drillDown(periods[index] as string, row)}
                    className="hover:text-accent hover:underline"
                  >
                    <Amount value={value} format={formatMoney} />
                  </Link>
                )}
              </Td>
            ))}
            <Td numeric className="font-medium">
              <Amount value={row.total} format={formatMoney} />
            </Td>
          </tr>
        ))}
        <tr className="font-medium">
          <Td>Total de {label.toLowerCase()}</Td>
          {section.totals.map((value, index) => (
            <Td key={periods[index]} numeric>
              <Amount value={value} format={formatMoney} />
            </Td>
          ))}
          <Td numeric>
            <Amount value={section.total} format={formatMoney} />
          </Td>
        </tr>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Fluxo de caixa"
        description="Regime de caixa: a data real do dinheiro. Não fecha com o DRE, e não deveria."
      />

      <div className="mb-6 flex justify-end">
        <ExportLinks
          slug={slug}
          report="fluxo-de-caixa"
          from={from.slice(0, 7)}
          to={toMonth.slice(0, 7)}
        />
      </div>

      {rangeForm}

      {report.warnings.map((warning) => (
        <p
          key={warning}
          className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          {warning}
        </p>
      ))}

      {cashAccounts.length === 0 ? (
        <EmptyState title="Nenhuma conta de dinheiro cadastrada">
          O fluxo de caixa precisa de pelo menos uma conta corrente. Cartão de crédito não
          conta — ele é dívida, não caixa.
        </EmptyState>
      ) : inflow.rows.length === 0 && outflow.rows.length === 0 && transfers.rows.length === 0 ? (
        <EmptyState title="Nenhum lançamento no período">
          O saldo inicial é {formatMoney(report.opening[0] ?? 0n)} e nada se moveu entre os
          meses escolhidos.
        </EmptyState>
      ) : (
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th className="sticky left-0 bg-background">Categoria</Th>
                {periods.map((period) => (
                  <Th key={period} numeric>
                    {formatPeriodShort(period)}
                  </Th>
                ))}
                <Th numeric>Total</Th>
              </tr>
            </thead>
            <tbody>
              <tr className="font-medium">
                <Td>Saldo inicial</Td>
                {report.opening.map((value, index) => (
                  <Td key={periods[index]} numeric>
                    <Amount value={value} format={formatMoney} />
                  </Td>
                ))}
                <Td numeric>
                  <Amount value={report.opening[0] ?? 0n} format={formatMoney} />
                </Td>
              </tr>

              {sectionRows(inflow, "Entradas")}
              {sectionRows(outflow, "Saídas")}

              <tr className="font-medium">
                <Td>Resultado de caixa</Td>
                {report.operating.map((value, index) => (
                  <Td key={periods[index]} numeric>
                    <Amount value={value} format={formatMoney} />
                  </Td>
                ))}
                <Td numeric>
                  <Amount value={inflow.total - outflow.total} format={formatMoney} />
                </Td>
              </tr>

              {sectionRows(transfers, "Transferências")}

              <tr className="font-medium">
                <Td>Movimento líquido</Td>
                {report.net.map((value, index) => (
                  <Td key={periods[index]} numeric>
                    <Amount value={value} format={formatMoney} />
                  </Td>
                ))}
                <Td numeric>
                  <Amount
                    value={inflow.total - outflow.total + transfers.total}
                    format={formatMoney}
                  />
                </Td>
              </tr>

              <tr className="font-semibold">
                <Td>Saldo final</Td>
                {report.closing.map((value, index) => (
                  <Td key={periods[index]} numeric>
                    <Amount value={value} format={formatMoney} />
                  </Td>
                ))}
                <Td numeric>
                  <Amount
                    value={report.closing[report.closing.length - 1] ?? 0n}
                    format={formatMoney}
                  />
                </Td>
              </tr>
            </tbody>
          </Table>
        </TableScroll>
      )}

      <div className="mt-6 flex flex-col gap-2 text-xs text-muted">
        <p>
          Contas consideradas: {cashAccounts.map((account) => account.name).join(", ")}.
          {cardAccounts.length > 0
            ? ` Fora do relatório: ${cardAccounts
                .map((account) => account.name)
                .join(", ")} — compra no cartão não é saída de caixa; o caixa se move
                quando a fatura é paga.`
            : ""}
        </p>
        <p>
          Transferência aparece em seção própria e não soma em entrada nem em saída, mas
          entra no saldo final — o dinheiro saiu da conta de verdade.
        </p>
        <p>Clique em qualquer valor para ver os lançamentos que o compõem.</p>
      </div>
    </>
  );
}
