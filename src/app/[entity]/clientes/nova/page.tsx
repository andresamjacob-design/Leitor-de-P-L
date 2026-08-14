import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { PageHeader } from "@/components/page-header";
import { ClientForm } from "../client-form";
import { resolveScope } from "@/lib/entities";

export default async function NewClientPage({
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
        title="Novo cliente"
        description="Um cliente pertence a uma entidade."
        entities={scope.entities}
        path="clientes/nova"
      />
    );
  }

  return (
    <>
      <PageHeader title="Novo cliente" description={scope.entity.name} />
      <ClientForm slug={slug} client={null} />
    </>
  );
}
