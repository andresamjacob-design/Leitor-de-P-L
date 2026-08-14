import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Amount, Table, TableScroll, Td, Th } from "@/components/ui/table";
import { listCategories } from "@/lib/data/categories";
import { listClients } from "@/lib/data/clients";
import { listContracts } from "@/lib/data/contracts";
import { listRecognition } from "@/lib/data/pl-report";
import { resolveScope } from "@/lib/entities";
import { formatPeriodShort, todayInSaoPaulo } from "@/lib/dates";
import { formatMoney, sum } from "@/lib/money";

const SOURCE_LABEL: Record<string, string> = {
  engine: "motor de contrato",
  cash_mirror: "espelho do caixa",
  manual: "manual",
  accrual: "provisão",
};

type Search = { de?: string; ate?: string; categorias?: string; origem?: string };

/**
 * What the P&L is made of.
 *
 * The cash flow drills into `cash_entries`; this is the other ledger's equivalent, and
 * it is where a DRE cell goes when someone asks "where does this number come from".
 */
export default async function RecognitionPage({
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
  const entityIds = entities.map((entity) => entity.id);
  const year = todayInSaoPaulo().slice(0, 4);

  const from = /^\d{4}-\d{2}$/.test(search.de ?? "") ? `${search.de}-01` : `${year}-01-01`;
  const to = /^\d{4}-\d{2}$/.test(search.ate ?? "") ? `${search.ate}-01` : `${year}-12-01`;

  const wanted = new Set((search.categorias ?? "").split(",").filter(Boolean));

  const [all, categories, clients, contracts] = await Promise.all([
    listRecognition(entityIds, { from, to: to < from ? from : to }),
    listCategories(entityIds, { includeInactive: true }),
    listClients(entityIds, { includeInactive: true }),
    listContracts(entityIds, { includeSuperseded: true }),
  ]);

  const rows = all
    .filter((row) => (wanted.size === 0 ? true : wanted.has(row.categoryId)))
    .filter((row) => (search.origem ? row.source === search.origem : true))
    .sort((a, b) => a.period.localeCompare(b.period) || a.categoryId.localeCompare(b.categoryId));

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));

  const revenue = sum(rows.filter((row) => row.kind === "revenue").map((row) => row.amount));
  const cost = sum(rows.filter((row) => row.kind === "cost").map((row) => row.amount));

  return (
    <>
      <PageHeader
        title="Competência"
        description="As linhas que formam o DRE. Receita vem de contrato; custo, do espelho do caixa."
      />

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <input type="hidden" name="categorias" value={search.categorias ?? ""} />
        <Field label="De" htmlFor="de">
          <Input id="de" name="de" type="month" defaultValue={from.slice(0, 7)} />
        </Field>
        <Field label="Até" htmlFor="ate">
          <Input id="ate" name="ate" type="month" defaultValue={to.slice(0, 7)} />
        </Field>
        <Field label="Origem" htmlFor="origem">
          <Select id="origem" name="origem" defaultValue={search.origem ?? ""}>
            <option value="">Todas</option>
            <option value="engine">Motor de contrato</option>
            <option value="cash_mirror">Espelho do caixa</option>
            <option value="manual">Manual</option>
          </Select>
        </Field>
        <Button type="submit" variant="outline" size="sm">
          Filtrar
        </Button>
        {wanted.size > 0 ? (
          <Link href={`/${slug}/competencia`} className="text-sm text-muted hover:text-foreground">
            Limpar categoria
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <EmptyState title="Nenhuma linha de competência neste filtro">
          Custos entram aqui quando um lançamento de caixa recebe categoria. Receita entra
          quando um contrato é reconhecido.
        </EmptyState>
      ) : (
        <>
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th className="w-20">Mês</Th>
                  <Th>Categoria</Th>
                  <Th>Contrato / cliente</Th>
                  <Th>Origem</Th>
                  <Th numeric className="w-32">Valor</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const category = categoryById.get(row.categoryId);
                  const contract = row.contractId ? contractById.get(row.contractId) : undefined;
                  const client = row.clientId ? clientById.get(row.clientId) : undefined;

                  return (
                    <tr key={row.id}>
                      <Td className="whitespace-nowrap tabular text-xs">
                        {formatPeriodShort(row.period)}
                      </Td>
                      <Td className="text-xs">
                        {category ? `${category.code} · ${category.name}` : "—"}
                      </Td>
                      <Td className="text-xs text-muted">
                        {contract ? (
                          <Link
                            href={`/${slug}/contratos/${contract.id}`}
                            className="text-accent hover:underline"
                          >
                            {contract.name}
                          </Link>
                        ) : (
                          (client?.name ?? "—")
                        )}
                      </Td>
                      <Td className="text-xs text-muted">
                        {SOURCE_LABEL[row.source] ?? row.source}
                        {row.manuallyEdited ? " · editada" : ""}
                        {row.isIntercompany ? " · intercompany" : ""}
                      </Td>
                      <Td numeric>
                        <Amount
                          value={row.kind === "revenue" ? row.amount : -row.amount}
                          format={formatMoney}
                        />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableScroll>

          <p className="mt-3 text-xs text-muted tabular">
            {rows.length} linha{rows.length === 1 ? "" : "s"} · receita {formatMoney(revenue)} ·
            custo {formatMoney(cost)} · resultado {formatMoney(revenue - cost)}.
          </p>
        </>
      )}
    </>
  );
}
