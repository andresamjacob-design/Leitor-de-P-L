import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Amount, Table, TableScroll, Td, Th } from "@/components/ui/table";
import { listCashEntries } from "@/lib/data/cash-entries";
import { listClients } from "@/lib/data/clients";
import { listContracts, listRecognitionForContract } from "@/lib/data/contracts";
import { listRecognition } from "@/lib/data/pl-report";
import { deferredRevenue } from "@/lib/recognition/engine";
import { resolveScope } from "@/lib/entities";
import { formatPeriodShort, periodOf, todayInSaoPaulo, type Period } from "@/lib/dates";
import { formatMoney, sum, type Cents } from "@/lib/money";

type Search = { de?: string; ate?: string };

/**
 * Revenue by client, and what is contracted but not yet earned.
 *
 * The deferred column is the bridge between the two ledgers (SPEC §10) — the number that
 * denounces a mistake in either. A negative one is not hidden behind a minus sign: it
 * means work was recognised beyond what the contract says, and it gets its own column
 * called "Receita a faturar" (D14a).
 */
export default async function RevenuePage({
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

  const [recognition, clients, contracts, cash] = await Promise.all([
    listRecognition(entityIds, { from, to: to < from ? from : to }),
    listClients(entityIds, { includeInactive: true }),
    listContracts(entityIds),
    listCashEntries({ entityIds, direction: "in", limit: 20000 }),
  ]);

  const clientById = new Map(clients.map((client) => [client.id, client]));
  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));

  // ---- Revenue by client, month by month ----------------------------------
  const periods: Period[] = [];
  for (let period = from; period <= to; period = nextMonth(period)) periods.push(period);

  type ClientRow = { clientId: string | null; recognized: Cents[]; received: Cents[] };
  const byClient = new Map<string, ClientRow>();
  const indexOf = new Map(periods.map((period, index) => [period, index]));

  const touch = (clientId: string | null): ClientRow => {
    const key = clientId ?? "";
    const current = byClient.get(key) ?? {
      clientId,
      recognized: periods.map(() => 0n),
      received: periods.map(() => 0n),
    };
    byClient.set(key, current);
    return current;
  };

  for (const row of recognition) {
    if (row.kind !== "revenue") continue;
    const index = indexOf.get(row.period);
    if (index === undefined) continue;
    const target = touch(row.clientId);
    target.recognized[index] = (target.recognized[index] as Cents) + row.amount;
  }

  for (const entry of cash) {
    // Only receipts that were attached to a client or a contract can be attributed.
    const clientId =
      entry.clientId ??
      (entry.contractId ? (contractById.get(entry.contractId)?.clientId ?? null) : null);
    if (clientId === null) continue;

    const index = indexOf.get(periodOf(entry.occurredOn));
    if (index === undefined) continue;
    const target = touch(clientId);
    target.received[index] = (target.received[index] as Cents) + entry.amount;
  }

  const clientRows = [...byClient.values()]
    .map((row) => ({
      ...row,
      name: row.clientId ? (clientById.get(row.clientId)?.name ?? "Cliente removido") : "Sem cliente",
      totalRecognized: sum(row.recognized),
      totalReceived: sum(row.received),
    }))
    .filter((row) => row.totalRecognized !== 0n || row.totalReceived !== 0n)
    .sort((a, b) => (b.totalRecognized > a.totalRecognized ? 1 : -1));

  // ---- Deferred revenue by contract ---------------------------------------
  const backlog = await Promise.all(
    contracts
      .filter((contract) => contract.status === "active" || contract.status === "completed")
      .map(async (contract) => {
        const rows = await listRecognitionForContract(contract.id);
        return { contract, deferred: deferredRevenue(contract, rows) };
      }),
  );

  const toRecognize = sum(
    backlog
      .map((item) => item.deferred.deferred)
      .filter((value): value is Cents => value !== null && value > 0n),
  );
  const toInvoice = sum(
    backlog
      .map((item) => item.deferred.deferred)
      .filter((value): value is Cents => value !== null && value < 0n)
      .map((value) => -value),
  );

  return (
    <>
      <PageHeader
        title="Receita"
        description="Reconhecida contra recebida, e o que ainda falta reconhecer dos contratos."
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

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium">Por cliente</h2>
        {clientRows.length === 0 ? (
          <EmptyState title="Nenhuma receita no período">
            Receita reconhecida vem de contrato. Recebimento só aparece por cliente quando o
            lançamento está amarrado a um cliente ou a um contrato.
          </EmptyState>
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th className="sticky left-0 bg-background">Cliente</Th>
                  {periods.map((period) => (
                    <Th key={period} numeric>
                      {formatPeriodShort(period)}
                    </Th>
                  ))}
                  <Th numeric>Total</Th>
                </tr>
              </thead>
              <tbody>
                {clientRows.map((row) => (
                  <Fragment key={row.clientId ?? "sem-cliente"}>
                    <tr>
                      <Td className="whitespace-nowrap font-medium">
                        {row.clientId ? (
                          <Link
                            href={`/${slug}/clientes/${row.clientId}`}
                            className="text-accent hover:underline"
                          >
                            {row.name}
                          </Link>
                        ) : (
                          row.name
                        )}
                        <span className="ml-2 text-xs font-normal text-muted">reconhecida</span>
                      </Td>
                      {row.recognized.map((amount, index) => (
                        <Td key={periods[index]} numeric>
                          {amount === 0n ? <span className="text-muted">—</span> : formatMoney(amount)}
                        </Td>
                      ))}
                      <Td numeric className="font-medium">
                        {formatMoney(row.totalRecognized)}
                      </Td>
                    </tr>
                    <tr className="text-muted">
                      <Td className="whitespace-nowrap pl-6 text-xs">recebida</Td>
                      {row.received.map((amount, index) => (
                        <Td key={periods[index]} numeric className="text-xs">
                          {amount === 0n ? "—" : formatMoney(amount)}
                        </Td>
                      ))}
                      <Td numeric className="text-xs">
                        {formatMoney(row.totalReceived)}
                      </Td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium">Receita diferida por contrato</h2>

        <dl className="mb-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">A reconhecer</dt>
            <dd className="tabular">{formatMoney(toRecognize)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Receita a faturar</dt>
            <dd className="tabular">{formatMoney(toInvoice)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Contratos considerados</dt>
            <dd className="tabular">{backlog.length}</dd>
          </div>
        </dl>

        {backlog.length === 0 ? (
          <EmptyState title="Nenhum contrato ativo">
            A receita diferida só existe onde há contrato com valor total ou prazo fechado.
          </EmptyState>
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>Contrato</Th>
                  <Th>Cliente</Th>
                  <Th numeric>Contratado</Th>
                  <Th numeric>Reconhecido</Th>
                  <Th numeric>A reconhecer</Th>
                  <Th numeric>A faturar</Th>
                </tr>
              </thead>
              <tbody>
                {backlog.map(({ contract, deferred }) => (
                  <tr key={contract.id}>
                    <Td>
                      <Link
                        href={`/${slug}/contratos/${contract.id}`}
                        className="text-accent hover:underline"
                      >
                        {contract.name}
                      </Link>
                    </Td>
                    <Td className="text-xs text-muted">
                      {clientById.get(contract.clientId)?.name ?? "—"}
                    </Td>
                    <Td numeric className="text-muted">
                      {deferred.contracted === null ? "aberto" : formatMoney(deferred.contracted)}
                    </Td>
                    <Td numeric>{formatMoney(deferred.recognized)}</Td>
                    <Td numeric>
                      {deferred.deferred === null || deferred.deferred <= 0n ? (
                        <span className="text-muted">—</span>
                      ) : (
                        formatMoney(deferred.deferred)
                      )}
                    </Td>
                    <Td numeric>
                      {deferred.deferred !== null && deferred.deferred < 0n ? (
                        <Amount value={-deferred.deferred} format={formatMoney} />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}

        <p className="mt-3 text-xs text-muted">
          “A faturar” é o contrário de diferida: foi reconhecido mais do que o contrato
          declara. Ela fica em coluna própria em vez de virar um número negativo escondido —
          é o sinal de que o contrato precisa de aditivo, ou de que o reconhecimento passou
          do ponto.
        </p>
      </section>
    </>
  );
}

function nextMonth(period: Period): Period {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}
