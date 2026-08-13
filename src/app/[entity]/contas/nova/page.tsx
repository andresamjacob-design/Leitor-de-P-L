import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { PageHeader } from "@/components/page-header";
import { AccountForm } from "../account-form";
import { resolveScope } from "@/lib/entities";

export default async function NewAccountPage({
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
        title="Nova conta"
        description="Uma conta pertence a uma entidade."
        entities={scope.entities}
        path="contas/nova"
      />
    );
  }

  return (
    <>
      <PageHeader title="Nova conta" description={scope.entity.name} />
      <AccountForm slug={slug} account={null} />
    </>
  );
}
