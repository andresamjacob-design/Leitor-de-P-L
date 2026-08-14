import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableScroll, Td, Th } from "@/components/ui/table";
import { listClients } from "@/lib/data/clients";
import { listInvoices } from "@/lib/data/invoices";
import { resolveScope } from "@/lib/entities";
import { formatPeriodShort, formatPtBRDate } from "@/lib/dates";
import { formatMoney, sum } from "@/lib/money";

const STATUS_LABEL: Record<string, string> = {
  issued: "emitida",
  partially_paid: "parcial",
  paid: "paga",
  cancelled: "cancelada",
};

export default async function InvoicesPage({
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
        title="Notas fiscais"
        description="O que foi faturado, e de qual mês de competência."
        entities={scope.entities}
        path="notas-fiscais"
      />
    );
  }

  const [invoices, clients] = await Promise.all([
    listInvoices([scope.entity.id]),
    listClients([scope.entity.id], { includeInactive: true }),
  ]);

  const clientById = new Map(clients.map((client) => [client.id, client]));
  const total = sum(
    invoices.filter((invoice) => invoice.status !== "cancelled").map((invoice) => invoice.grossAmount),
  );

  return (
    <>
      <PageHeader
        title="Notas fiscais"
        description="Registro das NFs emitidas em outro lugar. O sistema nunca emite uma."
      />

      <div className="mb-4 flex justify-end">
        <Link href={`/${slug}/notas-fiscais/nova`} className={buttonVariants({ size: "sm" })}>
          Lançar NF
        </Link>
      </div>

      {invoices.length === 0 ? (
        <EmptyState title="Nenhuma nota fiscal lançada">
          A NF não cria receita — o reconhecimento vem do contrato. Ela entra para que dê
          para comparar o que foi ganho, o que foi faturado e o que foi recebido.
        </EmptyState>
      ) : (
        <>
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th className="w-24">Número</Th>
                  <Th>Cliente</Th>
                  <Th className="w-24">Emissão</Th>
                  <Th className="w-24">Competência</Th>
                  <Th className="w-24">Situação</Th>
                  <Th numeric className="w-32">Valor</Th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className={invoice.status === "cancelled" ? "opacity-50" : ""}>
                    <Td>
                      <Link
                        href={`/${slug}/notas-fiscais/${invoice.id}`}
                        className="text-accent hover:underline"
                      >
                        {invoice.number}
                        {invoice.series ? `/${invoice.series}` : ""}
                      </Link>
                    </Td>
                    <Td className="text-xs text-muted">
                      {clientById.get(invoice.clientId)?.name ?? "—"}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-muted tabular">
                      {formatPtBRDate(invoice.issueDate)}
                    </Td>
                    <Td className="whitespace-nowrap text-xs tabular">
                      {formatPeriodShort(invoice.servicePeriod)}
                    </Td>
                    <Td className="text-xs text-muted">
                      {STATUS_LABEL[invoice.status] ?? invoice.status}
                    </Td>
                    <Td numeric>{formatMoney(invoice.grossAmount)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
          <p className="mt-3 text-xs text-muted tabular">
            {invoices.length} nota{invoices.length === 1 ? "" : "s"} · {formatMoney(total)}{" "}
            faturado, sem contar as canceladas.
          </p>
        </>
      )}
    </>
  );
}
