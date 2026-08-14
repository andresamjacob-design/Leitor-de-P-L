import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ClientForm } from "../client-form";
import { getClient } from "@/lib/data/clients";
import { resolveScope } from "@/lib/entities";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity: slug, id } = await params;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  const client = await getClient(id);
  if (!client) notFound();

  return (
    <>
      <PageHeader title={client.name} description="Editar cliente" />
      <ClientForm slug={slug} client={client} />
    </>
  );
}
