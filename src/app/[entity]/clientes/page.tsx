import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableScroll, Td, Th } from "@/components/ui/table";
import { listClients } from "@/lib/data/clients";
import { listContracts } from "@/lib/data/contracts";
import { resolveScope } from "@/lib/entities";
import { formatTaxId } from "@/lib/tax-id";

export default async function ClientsPage({
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
        title="Clientes"
        description="Quem paga, e por qual CNPJ o extrato os reconhece."
        entities={scope.entities}
        path="clientes"
      />
    );
  }

  const [clients, contracts] = await Promise.all([
    listClients([scope.entity.id], { includeInactive: true }),
    listContracts([scope.entity.id]),
  ]);

  const contractsByClient = new Map<string, number>();
  for (const contract of contracts) {
    contractsByClient.set(contract.clientId, (contractsByClient.get(contract.clientId) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Quem paga. O CNPJ é o que faz o extrato reconhecer o recebimento sozinho."
      />

      <div className="mb-4 flex justify-end">
        <Link href={`/${slug}/clientes/nova`} className={buttonVariants({ size: "sm" })}>
          Novo cliente
        </Link>
      </div>

      {clients.length === 0 ? (
        <EmptyState title="Nenhum cliente cadastrado">
          Um contrato precisa de um cliente. Comece por aqui.
        </EmptyState>
      ) : (
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>CNPJ / CPF</Th>
                <Th numeric className="w-28">Contratos</Th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id} className={client.active ? "" : "opacity-50"}>
                  <Td>
                    <Link
                      href={`/${slug}/clientes/${client.id}`}
                      className="text-accent hover:underline"
                    >
                      {client.name}
                    </Link>
                    {client.active ? null : <span className="ml-2 text-xs text-muted">inativo</span>}
                  </Td>
                  <Td className="tabular text-xs text-muted">
                    {client.taxId ? formatTaxId(client.taxId) : "—"}
                  </Td>
                  <Td numeric className="text-xs text-muted">
                    {contractsByClient.get(client.id) ?? 0}
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
