import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ContractForm } from "../contract-form";
import { listClients } from "@/lib/data/clients";
import { listCategories } from "@/lib/data/categories";
import { resolveScope } from "@/lib/entities";

const PREFILLABLE = [
  "name",
  "type",
  "totalValue",
  "monthlyValue",
  "startDate",
  "endDate",
  "billingTerms",
  "paymentTerms",
] as const;

export default async function NewContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { entity: slug } = await params;
  const query = await searchParams;
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

  const [clients, categories] = await Promise.all([
    listClients([scope.entity.id]),
    listCategories([scope.entity.id]),
  ]);
  const revenueCategories = categories.filter((category) => category.kind === "revenue");

  // Whatever the extraction proposed arrives as plain text and is validated on submit,
  // exactly like a value typed by hand (SPEC §9).
  const defaults: Record<string, string> = {};
  for (const field of PREFILLABLE) {
    const value = query[field];
    if (value) defaults[field] = value;
  }
  const fromDraft = Object.keys(defaults).length > 0 || Boolean(query.clientName);

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
      <PageHeader
        title="Novo contrato"
        description={
          fromDraft
            ? "A partir do rascunho lido pela IA — confira cada campo antes de salvar."
            : scope.entity.name
        }
      />
      <ContractForm
        slug={slug}
        contract={null}
        clients={clients}
        revenueCategories={revenueCategories}
        defaults={defaults}
        clientNameHint={query.clientName}
      />
    </>
  );
}
