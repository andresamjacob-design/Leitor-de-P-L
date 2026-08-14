import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Amount, Table, TableScroll, Td, Th } from "@/components/ui/table";
import { ContractForm } from "../contract-form";
import { PocForm, RunRecognition } from "../poc-form";
import { getClient, listClients } from "@/lib/data/clients";
import {
  getContract,
  listPocReports,
  listRecognitionForContract,
} from "@/lib/data/contracts";
import { listInvoices, reconcileContract } from "@/lib/data/invoices";
import { listCashEntries } from "@/lib/data/cash-entries";
import { deferredRevenue, planContract } from "@/lib/recognition/engine";
import { formatPercent } from "@/lib/recognition/percent";
import { resolveScope } from "@/lib/entities";
import { formatPeriod, formatPeriodShort, periodOf, todayInSaoPaulo } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export default async function ContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string; id: string }>;
  searchParams: Promise<{ aditivo?: string }>;
}) {
  const { entity: slug, id } = await params;
  const { aditivo } = await searchParams;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  const contract = await getContract(id);
  if (!contract) notFound();

  const today = periodOf(todayInSaoPaulo());

  const [client, clients, reports, recognition, invoices, receipts] = await Promise.all([
    getClient(contract.clientId),
    listClients([contract.entityId], { includeInactive: true }),
    listPocReports(contract.id),
    listRecognitionForContract(contract.id),
    listInvoices([contract.entityId], { contractId: contract.id }),
    listCashEntries({ entityIds: [contract.entityId], limit: 5000 }),
  ]);

  const contractReceipts = receipts.filter((entry) => entry.contractId === contract.id);
  const plan = planContract(contract, { through: today, pocReports: reports });
  const deferred = deferredRevenue(contract, recognition);
  const reconciliation = reconcileContract({ recognition, invoices, receipts: contractReceipts });

  const lastReport = reports[reports.length - 1];
  const amending = aditivo === "1";

  return (
    <>
      <PageHeader
        title={contract.name}
        description={`${client?.name ?? "cliente desconhecido"} · versão ${contract.version}`}
      />

      <dl className="mb-8 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">Contratado</dt>
          <dd className="tabular">
            {deferred.contracted === null ? "—" : formatMoney(deferred.contracted)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Reconhecido</dt>
          <dd className="tabular">{formatMoney(deferred.recognized)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">
            {deferred.deferred !== null && deferred.deferred < 0n
              ? "Receita a faturar"
              : "A reconhecer"}
          </dt>
          <dd className="tabular">
            {deferred.deferred === null ? (
              <span className="text-muted">contrato aberto</span>
            ) : (
              <Amount value={deferred.deferred} format={formatMoney} />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Recebido</dt>
          <dd className="tabular">{formatMoney(reconciliation.totals.received)}</dd>
        </div>
      </dl>

      {plan.warnings.length > 0 ? (
        <div className="mb-6 flex flex-col gap-2">
          {plan.warnings.map((warning) => (
            <p
              key={warning}
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      {plan.missingReports.length > 0 ? (
        <p className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Sem reporte de POC em{" "}
          {plan.missingReports.map((period) => formatPeriodShort(period)).join(", ")} — esses
          meses reconhecem zero até alguém reportar.
        </p>
      ) : null}

      {contract.recognitionMethod === "poc" ? (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-medium">Reportar avanço</h2>
          <PocForm
            slug={slug}
            contractId={contract.id}
            defaultPeriod={today.slice(0, 7)}
            lastCumulative={lastReport ? formatPercent(lastReport.cumulative) : null}
          />

          {reports.length > 0 ? (
            <div className="mt-4">
              <TableScroll>
                <Table>
                  <thead>
                    <tr>
                      <Th>Mês</Th>
                      <Th numeric className="w-32">Acumulado</Th>
                      <Th className="w-28">Correção</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((report) => (
                      <tr key={report.id}>
                        <Td>{formatPeriod(report.period)}</Td>
                        <Td numeric>{formatPercent(report.cumulative)}%</Td>
                        <Td className="text-xs text-muted">{report.isCorrection ? "sim" : "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Reconhecido, faturado e recebido</h2>
          <RunRecognition slug={slug} contractId={contract.id} label="Recalcular" />
        </div>

        {reconciliation.rows.length === 0 ? (
          <p className="text-sm text-muted">
            Nada reconhecido ainda. Rode o reconhecimento — ou, num projeto por POC,
            reporte o primeiro avanço.
          </p>
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>Mês</Th>
                  <Th numeric>Reconhecido</Th>
                  <Th numeric>Faturado</Th>
                  <Th numeric>Recebido</Th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.rows.map((row) => (
                  <tr key={row.period}>
                    <Td>{formatPeriod(row.period)}</Td>
                    <Td numeric>
                      <Amount value={row.recognized} format={formatMoney} />
                    </Td>
                    <Td numeric className="text-muted">
                      {row.invoiced === 0n ? "—" : formatMoney(row.invoiced)}
                    </Td>
                    <Td numeric className="text-muted">
                      {row.received === 0n ? "—" : formatMoney(row.received)}
                    </Td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <Td>Total</Td>
                  <Td numeric>
                    <Amount value={reconciliation.totals.recognized} format={formatMoney} />
                  </Td>
                  <Td numeric>{formatMoney(reconciliation.totals.invoiced)}</Td>
                  <Td numeric>{formatMoney(reconciliation.totals.received)}</Td>
                </tr>
              </tbody>
            </Table>
          </TableScroll>
        )}

        <p className="mt-3 text-xs text-muted">
          As três colunas medem coisas diferentes e não têm obrigação de bater mês a mês:
          reconhecido é quando foi ganho, faturado é quando a NF saiu, recebido é quando o
          dinheiro entrou. É a diferença entre elas que vale olhar.
        </p>
      </section>

      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Notas fiscais</h2>
          <Link
            href={`/${slug}/notas-fiscais/nova?contrato=${contract.id}`}
            className="text-sm text-accent hover:underline"
          >
            Lançar NF
          </Link>
        </div>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma nota fiscal lançada para este contrato.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {invoices.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  href={`/${slug}/notas-fiscais/${invoice.id}`}
                  className="text-accent hover:underline"
                >
                  NF {invoice.number}
                </Link>
                <span className="ml-2 text-xs text-muted tabular">
                  {formatPeriod(invoice.servicePeriod)} · {formatMoney(invoice.grossAmount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-medium">
          {amending ? "Aditivo" : "Editar contrato"}
        </h2>
        {amending ? null : (
          <p className="mb-3 text-xs text-muted">
            Mudou o valor ou o prazo? Prefira{" "}
            <Link href={`?aditivo=1`} className="text-accent hover:underline">
              criar um aditivo
            </Link>{" "}
            — ele guarda a versão anterior e não reescreve os meses já reconhecidos.
          </p>
        )}
        <ContractForm slug={slug} contract={contract} clients={clients} amend={amending} />
      </section>
    </>
  );
}
