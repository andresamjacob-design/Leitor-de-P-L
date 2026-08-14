import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Amount, Table, TableScroll, Td, Th } from "@/components/ui/table";
import { listClients, listPeopleRecords } from "@/lib/data/clients";
import { listRecognition } from "@/lib/data/pl-report";
import { resolveScope } from "@/lib/entities";
import { todayInSaoPaulo } from "@/lib/dates";
import { formatMoney, mulRatio, sum, type Cents } from "@/lib/money";

type Search = { de?: string; ate?: string };

/**
 * Margin by client (D60, answering Q7).
 *
 * Revenue recognised for the client, minus the cost of the people allocated to it. The
 * allocation comes from `people.client_id`, which the `Colaboradores` sheet already
 * tracked and the Pessoas screen fills in.
 *
 * What this deliberately does **not** do is apportion overhead. Rent, tools and
 * accounting are not split across clients by some rule nobody agreed to — the margin here
 * is revenue minus the payroll directly attached, and the screen says so. A number with an
 * invented apportionment inside looks more precise and is less true.
 */
export default async function MarginPage({
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

  const [recognition, clients, people] = await Promise.all([
    listRecognition(entityIds, { from, to: to < from ? from : to }),
    listClients(entityIds, { includeInactive: true }),
    listPeopleRecords(entityIds, { includeInactive: true }),
  ]);

  const clientOfPerson = new Map(people.map((person) => [person.id, person.clientId]));
  const clientById = new Map(clients.map((client) => [client.id, client]));

  type Row = { revenue: Cents; payroll: Cents; people: Set<string> };
  const byClient = new Map<string, Row>();
  const touch = (clientId: string): Row => {
    const current = byClient.get(clientId) ?? { revenue: 0n, payroll: 0n, people: new Set<string>() };
    byClient.set(clientId, current);
    return current;
  };

  let unallocatedPayroll = 0n;

  for (const row of recognition) {
    if (row.kind === "revenue") {
      if (row.clientId) touch(row.clientId).revenue += row.amount;
      continue;
    }
    // Cost only counts against a client when the person behind it is allocated to one.
    const clientId = row.personId ? (clientOfPerson.get(row.personId) ?? null) : null;
    if (clientId === null) {
      if (row.personId !== null) unallocatedPayroll += row.amount;
      continue;
    }
    const target = touch(clientId);
    target.payroll += row.amount;
    if (row.personId) target.people.add(row.personId);
  }

  const rows = [...byClient]
    .map(([clientId, row]) => ({
      clientId,
      name: clientById.get(clientId)?.name ?? "Cliente removido",
      revenue: row.revenue,
      payroll: row.payroll,
      margin: row.revenue - row.payroll,
      people: row.people.size,
    }))
    .filter((row) => row.revenue !== 0n || row.payroll !== 0n)
    .sort((a, b) => (b.margin > a.margin ? 1 : b.margin < a.margin ? -1 : 0));

  const totals = {
    revenue: sum(rows.map((row) => row.revenue)),
    payroll: sum(rows.map((row) => row.payroll)),
  };

  return (
    <>
      <PageHeader
        title="Margem por cliente"
        description="Receita reconhecida menos o custo das pessoas alocadas ao cliente."
      />

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

      {rows.length === 0 ? (
        <EmptyState title="Nada para comparar ainda">
          Precisa de receita reconhecida com cliente e de pessoas alocadas a ele em{" "}
          <Link href={`/${slug}/pessoas`} className="text-accent underline underline-offset-2">
            Pessoas
          </Link>
          .
        </EmptyState>
      ) : (
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th>Cliente</Th>
                <Th numeric className="w-20">Pessoas</Th>
                <Th numeric>Receita</Th>
                <Th numeric>Folha alocada</Th>
                <Th numeric>Margem</Th>
                <Th numeric className="w-20">%</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.clientId}>
                  <Td>
                    <Link
                      href={`/${slug}/clientes/${row.clientId}`}
                      className="text-accent hover:underline"
                    >
                      {row.name}
                    </Link>
                  </Td>
                  <Td numeric className="text-xs text-muted">{row.people}</Td>
                  <Td numeric>{formatMoney(row.revenue)}</Td>
                  <Td numeric className="text-muted">{formatMoney(row.payroll)}</Td>
                  <Td numeric className="font-medium">
                    <Amount value={row.margin} format={formatMoney} />
                  </Td>
                  <Td numeric className="text-xs text-muted">
                    {row.revenue === 0n
                      ? "—"
                      : `${formatMoney(mulRatio(row.margin, 10000n, row.revenue))}%`}
                  </Td>
                </tr>
              ))}
              <tr className="font-semibold">
                <Td colSpan={2}>Total</Td>
                <Td numeric>{formatMoney(totals.revenue)}</Td>
                <Td numeric>{formatMoney(totals.payroll)}</Td>
                <Td numeric>
                  <Amount value={totals.revenue - totals.payroll} format={formatMoney} />
                </Td>
                <Td numeric>
                  {totals.revenue === 0n
                    ? "—"
                    : `${formatMoney(mulRatio(totals.revenue - totals.payroll, 10000n, totals.revenue))}%`}
                </Td>
              </tr>
            </tbody>
          </Table>
        </TableScroll>
      )}

      <div className="mt-4 flex flex-col gap-2 text-xs text-muted">
        <p>
          <strong>Esta margem é bruta de propósito.</strong> Nada de aluguel, ferramentas ou
          contabilidade é rateado entre os clientes — ratear por uma regra que ninguém
          combinou daria um número mais preciso na aparência e menos verdadeiro.
        </p>
        {unallocatedPayroll !== 0n ? (
          <p>
            <span className="tabular">{formatMoney(unallocatedPayroll)}</span> de folha é de
            pessoas sem cliente alocado e não entra em nenhuma linha acima.
          </p>
        ) : null}
      </div>
    </>
  );
}
