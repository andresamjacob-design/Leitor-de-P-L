import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { InvoiceForm } from "../invoice-form";
import { listClients } from "@/lib/data/clients";
import { listContracts } from "@/lib/data/contracts";
import { resolveScope } from "@/lib/entities";

export default async function NewInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<{ contrato?: string }>;
}) {
  const { entity: slug } = await params;
  const { contrato } = await searchParams;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  if (scope.kind === "consolidated") {
    return (
      <ConsolidatedNotice
        title="Lançar NF"
        description="Uma nota fiscal pertence a uma entidade."
        entities={scope.entities}
        path="notas-fiscais/nova"
      />
    );
  }

  const [clients, contracts] = await Promise.all([
    listClients([scope.entity.id]),
    listContracts([scope.entity.id]),
  ]);

  if (clients.length === 0) {
    return (
      <>
        <PageHeader title="Lançar NF" description={scope.entity.name} />
        <EmptyState title="Nenhum cliente cadastrado">
          Uma nota fiscal é emitida contra um cliente. Cadastre o cliente primeiro.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Lançar NF" description={scope.entity.name} />
      <InvoiceForm
        slug={slug}
        invoice={null}
        clients={clients}
        contracts={contracts}
        defaultContractId={contrato}
      />
    </>
  );
}
