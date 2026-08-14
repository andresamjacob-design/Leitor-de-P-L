import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { ExportLinks } from "@/components/export-links";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Amount, Table, TableScroll, Td, Th } from "@/components/ui/table";
import { compareLedgers, loadPl } from "@/lib/data/pl-report";
import { ELIMINATION_KEY, TOTAL_KEY, type PlLine } from "@/lib/pl";
import { resolveScope } from "@/lib/entities";
import { formatPeriodShort, todayInSaoPaulo } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Search = { de?: string; ate?: string };

export default async function PlPage({
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
  const consolidated = scope.kind === "consolidated";
  const year = todayInSaoPaulo().slice(0, 4);

  const from = /^\d{4}-\d{2}$/.test(search.de ?? "") ? `${search.de}-01` : `${year}-01-01`;
  const to = /^\d{4}-\d{2}$/.test(search.ate ?? "") ? `${search.ate}-01` : `${year}-12-01`;

  const rangeForm = (
    <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
      <Field label="De" htmlFor="de">
        <Input id="de" name="de" type="month" defaultValue={from.slice(0, 7)} />
      </Field>
      <Field label="Até" htmlFor="ate">
        <Input id="ate" name="ate" type="month" defaultValue={to.slice(0, 7)} />
      </Field>
      <Button type="submit" variant="outline" size="sm">
        Aplicar
      </Button>
    </form>
  );

  if (to < from) {
    return (
      <>
        <PageHeader title="DRE gerencial" description="Regime de competência." />

      <div className="mb-6 flex justify-end">
        <ExportLinks slug={slug} report="dre" from={from.slice(0, 7)} to={to.slice(0, 7)} />
      </div>
        {rangeForm}
        <EmptyState title="Intervalo inválido">
          O mês final vem antes do inicial. Ajuste o filtro e tente de novo.
        </EmptyState>
      </>
    );
  }

  const [{ report, rows, categoryIds }, ledgers] = await Promise.all([
    loadPl({
      entityIds: entities.map((entity) => entity.id),
      entities: entities.map((entity) => ({ id: entity.id, name: entity.name })),
      from,
      to,
      consolidated,
    }),
    compareLedgers({ entityIds: entities.map((entity) => entity.id), from, to }),
  ]);

  /** A cell opens as the competência rows behind it. */
  function drillDown(line: PlLine, columnKey: string): string | null {
    if (line.categoryId === null) return null;
    const ids = categoryIds.get(line.categoryId) ?? [line.categoryId];
    const query = new URLSearchParams({ categorias: ids.join(",") });
    // Per entity a column is a month, so the drill-down narrows to it; consolidated
    // columns are entities, and the whole range is the honest window.
    query.set("de", consolidated ? from.slice(0, 7) : columnKey.slice(0, 7));
    query.set("ate", consolidated ? to.slice(0, 7) : columnKey.slice(0, 7));
    return `/${slug}/competencia?${query.toString()}`;
  }

  return (
    <>
      <PageHeader
        title="DRE gerencial"
        description={
          consolidated
            ? "Regime de competência, com uma coluna por entidade e a eliminação do que o grupo cobra de si mesmo."
            : "Regime de competência: quando foi ganho ou devido, não quando o dinheiro se moveu."
        }
      />

      {rangeForm}

      {report.warnings.map((warning) => (
        <p
          key={warning}
          className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          {warning}
        </p>
      ))}

      {rows.length === 0 ? (
        <EmptyState title="Nada em competência neste período">
          O DRE lê apenas a competência. Custos aparecem quando um lançamento de caixa é
          categorizado; receita, quando um contrato é reconhecido em{" "}
          <Link href={`/${slug}/contratos`} className="text-accent underline underline-offset-2">
            Contratos
          </Link>
          .
        </EmptyState>
      ) : (
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th className="sticky left-0 bg-background">Linha</Th>
                {report.columns.map((column) => (
                  <Th
                    key={column.key}
                    numeric
                    className={column.key === TOTAL_KEY ? "text-foreground" : ""}
                  >
                    {column.label}
                  </Th>
                ))}
                {consolidated ? null : <Th numeric>Total</Th>}
              </tr>
            </thead>
            <tbody>
              {report.lines.map((line) => (
                <tr
                  key={line.key}
                  className={cn(
                    line.kind === "subtotal" && "font-semibold",
                    line.kind === "group" && "font-medium",
                    line.key === "result" && "border-t-2 border-border",
                  )}
                >
                  <Td
                    className={cn(
                      "whitespace-nowrap",
                      line.kind === "category" && "pl-6 text-muted",
                    )}
                  >
                    {line.label}
                  </Td>
                  {line.values.map((amount, index) => {
                    const column = report.columns[index];
                    const href = column ? drillDown(line, column.key) : null;
                    const isDerived =
                      column?.key === TOTAL_KEY || column?.key === ELIMINATION_KEY;

                    return (
                      <Td key={column?.key ?? index} numeric>
                        {amount === 0n ? (
                          <span className="text-muted">—</span>
                        ) : href && !isDerived ? (
                          <Link href={href} className="hover:text-accent hover:underline">
                            <Amount value={amount} format={formatMoney} />
                          </Link>
                        ) : (
                          <Amount value={amount} format={formatMoney} />
                        )}
                      </Td>
                    );
                  })}
                  {consolidated ? null : (
                    <Td numeric>
                      <Amount value={line.total} format={formatMoney} />
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-medium">Os dois razões, lado a lado</h2>
        <p className="mb-3 text-xs text-muted">
          Não é para bater. Receita ganha em março pode entrar em maio, e a compra de
          fevereiro no cartão sai do banco em março. A tabela existe para que a diferença
          seja legível, não para ser zerada.
        </p>

        {ledgers.rows.length === 0 ? (
          <p className="text-sm text-muted">Nenhum movimento no período.</p>
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>Mês</Th>
                  <Th numeric>Receita reconhecida</Th>
                  <Th numeric>Entrou no caixa</Th>
                  <Th numeric>Custo reconhecido</Th>
                  <Th numeric>Saiu do caixa</Th>
                </tr>
              </thead>
              <tbody>
                {ledgers.rows.map((row) => (
                  <tr key={row.period}>
                    <Td>{formatPeriodShort(row.period)}</Td>
                    <Td numeric>{formatMoney(row.recognizedRevenue)}</Td>
                    <Td numeric className="text-muted">{formatMoney(row.cashIn)}</Td>
                    <Td numeric>{formatMoney(row.recognizedCost)}</Td>
                    <Td numeric className="text-muted">{formatMoney(row.cashOut)}</Td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <Td>Total</Td>
                  <Td numeric>{formatMoney(ledgers.totals.recognizedRevenue)}</Td>
                  <Td numeric>{formatMoney(ledgers.totals.cashIn)}</Td>
                  <Td numeric>{formatMoney(ledgers.totals.recognizedCost)}</Td>
                  <Td numeric>{formatMoney(ledgers.totals.cashOut)}</Td>
                </tr>
              </tbody>
            </Table>
          </TableScroll>
        )}
      </section>
    </>
  );
}
