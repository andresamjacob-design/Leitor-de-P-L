import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Amount, Table, TableScroll, Td, Th } from "@/components/ui/table";
import { RunRecognition } from "./poc-form";
import { listClients } from "@/lib/data/clients";
import { listContracts } from "@/lib/data/contracts";
import { resolveScope } from "@/lib/entities";
import { formatPtBRDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

const STATUS_LABEL: Record<string, string> = {
  draft: "rascunho",
  active: "ativo",
  completed: "concluído",
  cancelled: "cancelado",
};

const METHOD_LABEL: Record<string, string> = {
  straight_line: "linha reta",
  poc: "POC",
  manual: "manual",
};

export default async function ContractsPage({
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
        title="Contratos"
        description="De onde vem a receita, e quando ela é considerada ganha."
        entities={scope.entities}
        path="contratos"
      />
    );
  }

  const [contracts, clients] = await Promise.all([
    listContracts([scope.entity.id]),
    listClients([scope.entity.id], { includeInactive: true }),
  ]);

  const clientById = new Map(clients.map((client) => [client.id, client]));

  return (
    <>
      <PageHeader
        title="Contratos"
        description="De onde vem a receita. O reconhecimento sai daqui, nunca da data em que o dinheiro entrou."
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <RunRecognition slug={slug} label="Reconhecer todos os contratos" />
        <Link href={`/${slug}/contratos/novo`} className={buttonVariants({ size: "sm" })}>
          Novo contrato
        </Link>
      </div>

      {contracts.length === 0 ? (
        <EmptyState title="Nenhum contrato cadastrado">
          Sem contrato não há receita reconhecida — o DRE fica só com os custos. Comece
          cadastrando um cliente e depois o contrato dele.
        </EmptyState>
      ) : (
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th>Contrato</Th>
                <Th>Cliente</Th>
                <Th>Reconhecimento</Th>
                <Th>Período</Th>
                <Th>Situação</Th>
                <Th numeric className="w-32">Valor</Th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((contract) => (
                <tr key={contract.id} className={contract.status === "cancelled" ? "opacity-50" : ""}>
                  <Td>
                    <Link
                      href={`/${slug}/contratos/${contract.id}`}
                      className="text-accent hover:underline"
                    >
                      {contract.name}
                    </Link>
                    {contract.version > 1 ? (
                      <span className="ml-2 text-xs text-muted">v{contract.version}</span>
                    ) : null}
                  </Td>
                  <Td className="text-xs text-muted">
                    {clientById.get(contract.clientId)?.name ?? "—"}
                  </Td>
                  <Td className="text-xs text-muted">
                    {METHOD_LABEL[contract.recognitionMethod] ?? contract.recognitionMethod}
                    {contract.type === "retainer" ? " · contínuo" : " · projeto"}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted tabular">
                    {contract.startDate ? formatPtBRDate(contract.startDate) : "—"}
                    {contract.endDate ? ` a ${formatPtBRDate(contract.endDate)}` : " · aberto"}
                  </Td>
                  <Td className="text-xs">{STATUS_LABEL[contract.status] ?? contract.status}</Td>
                  <Td numeric>
                    {contract.monthlyValue !== null ? (
                      <>
                        <Amount value={contract.monthlyValue} format={formatMoney} />
                        <span className="text-xs text-muted">/mês</span>
                      </>
                    ) : contract.totalValue !== null ? (
                      <Amount value={contract.totalValue} format={formatMoney} />
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
    </>
  );
}
