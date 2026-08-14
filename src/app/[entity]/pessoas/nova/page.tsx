import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { PageHeader } from "@/components/page-header";
import { PersonForm } from "../person-form";
import { listClients } from "@/lib/data/clients";
import { resolveScope } from "@/lib/entities";

export default async function NewPersonPage({
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
        title="Nova pessoa"
        description="Uma pessoa pertence a uma entidade."
        entities={scope.entities}
        path="pessoas/nova"
      />
    );
  }

  const clients = await listClients([scope.entity.id]);

  return (
    <>
      <PageHeader title="Nova pessoa" description={scope.entity.name} />
      <PersonForm slug={slug} person={null} clients={clients} />
    </>
  );
}
