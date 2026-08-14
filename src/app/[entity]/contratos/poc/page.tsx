import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { BatchPocForm, type PocRow } from "./batch-form";
import { listClients } from "@/lib/data/clients";
import {
  listContracts,
  listPocReports,
  listRecognitionForContract,
} from "@/lib/data/contracts";
import { resolveScope } from "@/lib/entities";
import { formatPeriodShort, periodOf, todayInSaoPaulo } from "@/lib/dates";
import { formatMoney, sum } from "@/lib/money";
import { formatPercent } from "@/lib/recognition/percent";

export default async function BatchPocPage({
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
        title="Reportar avanço"
        description="POC de todos os projetos abertos, de uma vez."
        entities={scope.entities}
        path="contratos/poc"
      />
    );
  }

  const today = periodOf(todayInSaoPaulo());
  const [contracts, clients] = await Promise.all([
    listContracts([scope.entity.id]),
    listClients([scope.entity.id], { includeInactive: true }),
  ]);

  const open = contracts.filter(
    (contract) => contract.recognitionMethod === "poc" && contract.status === "active",
  );
  const clientById = new Map(clients.map((client) => [client.id, client]));

  const rows: PocRow[] = await Promise.all(
    open.map(async (contract) => {
      const [reports, recognition] = await Promise.all([
        listPocReports(contract.id),
        listRecognitionForContract(contract.id),
      ]);
      const last = reports[reports.length - 1];
      const thisMonth = reports.find((report) => report.period === today);

      return {
        contractId: contract.id,
        contractName: contract.name,
        clientName: clientById.get(contract.clientId)?.name ?? "—",
        totalValue: contract.totalValue === null ? "—" : formatMoney(contract.totalValue),
        lastCumulative: last ? formatPercent(last.cumulative) : null,
        lastPeriod: last ? formatPeriodShort(last.period) : null,
        recognized: sum(recognition.map((row) => row.amount)),
        alreadyReported: thisMonth ? formatPercent(thisMonth.cumulative) : null,
      };
    }),
  );

  return (
    <>
      <PageHeader
        title="Reportar avanço"
        description="Todos os projetos abertos numa tela só. O percentual é acumulado, não o do mês."
      />

      {rows.length === 0 ? (
        <EmptyState title="Nenhum projeto por POC em aberto">
          Só aparecem aqui contratos ativos com reconhecimento por POC.{" "}
          <Link href={`/${slug}/contratos`} className="text-accent underline underline-offset-2">
            Ver contratos
          </Link>
        </EmptyState>
      ) : (
        <BatchPocForm slug={slug} defaultPeriod={today.slice(0, 7)} rows={rows} />
      )}
    </>
  );
}
