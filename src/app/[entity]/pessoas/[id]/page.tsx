import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { PersonForm } from "../person-form";
import { getPerson, listClients } from "@/lib/data/clients";
import { resolveScope } from "@/lib/entities";

export default async function EditPersonPage({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity: slug, id } = await params;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  const person = await getPerson(id);
  if (!person) notFound();

  const clients = await listClients([person.entityId], { includeInactive: true });

  return (
    <>
      <PageHeader title={person.name} description="Editar pessoa" />
      <PersonForm slug={slug} person={person} clients={clients} />
    </>
  );
}
