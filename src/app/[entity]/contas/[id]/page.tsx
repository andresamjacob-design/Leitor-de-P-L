import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { AccountForm } from "../account-form";
import { getAccount } from "@/lib/data/accounts";
import { resolveScope } from "@/lib/entities";

export default async function EditAccountPage({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity: slug, id } = await params;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  // RLS already limits what `getAccount` can return; a miss here is a real 404.
  const account = await getAccount(id);
  if (!account) notFound();

  return (
    <>
      <PageHeader title={account.name} description="Editar conta" />
      <AccountForm slug={slug} account={account} />
    </>
  );
}
