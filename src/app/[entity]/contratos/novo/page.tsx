import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ContractForm } from "../contract-form";
import { listClients } from "@/lib/data/clients";
import { resolveScope } from "@/lib/entities";

export default async function NewContractPage({
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
        title="Novo contrato"
        description="Um contrato pertence a uma entidade."
        entities={scope.entities}
        path="contratos/novo"
      />
    );
  }

  const clients = await listClients([scope.entity.id]);

  if (clients.length === 0) {
    return (
      <>
        <PageHeader title="Novo contrato" description={scope.entity.name} />
        <EmptyState title="Nenhum cliente cadastrado">
          Um contrato pertence a um cliente. Cadastre o cliente primeiro.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Novo contrato" description={scope.entity.name} />
      <ContractForm slug={slug} contract={null} clients={clients} />
    </>
  );
}
