import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Table, TableScroll, Td, Th } from "@/components/ui/table";
import { listClients, listPeopleRecords } from "@/lib/data/clients";
import { listRecognition } from "@/lib/data/pl-report";
import { resolveScope } from "@/lib/entities";
import { formatPeriodShort, todayInSaoPaulo, type Period } from "@/lib/dates";
import { formatMoney, sum, type Cents } from "@/lib/money";

type Search = { de?: string; ate?: string };

/**
 * Payroll by person, in competência.
 *
 * It reads the recognition ledger, not the bank: a salary paid in February for January
 * belongs to January here, which is the whole point of the competência override (D2b).
 * A cost only appears with a name attached — anything nobody linked to a person is simply
 * missing from this screen, and the note at the bottom says so rather than letting the
 * total pass for the whole payroll.
 */
export default async function PayrollPage({
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

  const [recognition, people, clients] = await Promise.all([
    listRecognition(entityIds, { from, to: to < from ? from : to }),
    listPeopleRecords(entityIds, { includeInactive: true }),
    listClients(entityIds, { includeInactive: true }),
  ]);

  const periods: Period[] = [];
  for (let period = from; period <= to; period = nextMonth(period)) periods.push(period);
  const indexOf = new Map(periods.map((period, index) => [period, index]));

  const personById = new Map(people.map((person) => [person.id, person]));
  const clientById = new Map(clients.map((client) => [client.id, client]));

  const byPerson = new Map<string, Cents[]>();
  let unattributed = 0n;

  for (const row of recognition) {
    if (row.kind !== "cost") continue;
    const index = indexOf.get(row.period);
    if (index === undefined) continue;

    if (row.personId === null) {
      unattributed += row.amount;
      continue;
    }
    const values = byPerson.get(row.personId) ?? periods.map(() => 0n);
    values[index] = (values[index] as Cents) + row.amount;
    byPerson.set(row.personId, values);
  }

  const rows = [...byPerson]
    .map(([personId, values]) => ({
      personId,
      person: personById.get(personId),
      values,
      total: sum(values),
    }))
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));

  const totals = periods.map((_, index) => sum(rows.map((row) => row.values[index] as Cents)));

  return (
    <>
      <PageHeader
        title="Folha por pessoa"
        description="Em competência: o salário de janeiro pago em fevereiro conta em janeiro."
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
        <EmptyState title="Nenhum custo com pessoa identificada">
          Uma linha só aparece aqui quando o lançamento está amarrado a uma pessoa. Cadastre
          as pessoas em{" "}
          <Link href={`/${slug}/pessoas`} className="text-accent underline underline-offset-2">
            Pessoas
          </Link>{" "}
          e o motor de categorização passa a reconhecer o nome no extrato.
        </EmptyState>
      ) : (
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th className="sticky left-0 bg-background">Pessoa</Th>
                <Th>Cargo</Th>
                <Th>Cliente</Th>
                {periods.map((period) => (
                  <Th key={period} numeric>
                    {formatPeriodShort(period)}
                  </Th>
                ))}
                <Th numeric>Total</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.personId}>
                  <Td className="whitespace-nowrap">
                    {row.person ? (
                      <Link
                        href={`/${slug}/pessoas/${row.personId}`}
                        className="text-accent hover:underline"
                      >
                        {row.person.name}
                      </Link>
                    ) : (
                      "Pessoa removida"
                    )}
                  </Td>
                  <Td className="text-xs text-muted">{row.person?.role ?? "—"}</Td>
                  <Td className="text-xs text-muted">
                    {row.person?.clientId ? (clientById.get(row.person.clientId)?.name ?? "—") : "—"}
                  </Td>
                  {row.values.map((amount, index) => (
                    <Td key={periods[index]} numeric>
                      {amount === 0n ? <span className="text-muted">—</span> : formatMoney(amount)}
                    </Td>
                  ))}
                  <Td numeric className="font-medium">
                    {formatMoney(row.total)}
                  </Td>
                </tr>
              ))}
              <tr className="font-semibold">
                <Td colSpan={3}>Total atribuído</Td>
                {totals.map((amount, index) => (
                  <Td key={periods[index]} numeric>
                    {formatMoney(amount)}
                  </Td>
                ))}
                <Td numeric>{formatMoney(sum(totals))}</Td>
              </tr>
            </tbody>
          </Table>
        </TableScroll>
      )}

      <p className="mt-4 text-xs text-muted">
        Esta tela só mostra custo amarrado a uma pessoa. No período há{" "}
        <span className="tabular">{formatMoney(unattributed)}</span> de custo sem pessoa
        identificada — não é erro de cálculo, é o que falta amarrar, e é por isso que o
        total daqui pode ser menor que a linha de Pessoal no DRE.
      </p>
    </>
  );
}

function nextMonth(period: Period): Period {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}
