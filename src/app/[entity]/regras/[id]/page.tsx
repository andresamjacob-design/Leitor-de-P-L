import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { RuleForm } from "../rule-form";
import { DeleteRule } from "../delete-rule";
import { listAccounts } from "@/lib/data/accounts";
import { listCategories } from "@/lib/data/categories";
import { getRule } from "@/lib/data/rules";
import { resolveScope } from "@/lib/entities";

export default async function EditRulePage({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity: slug, id } = await params;
  const scope = await resolveScope(slug);
  if (!scope) notFound();
  if (scope.kind === "consolidated") notFound();

  const rule = await getRule(id);
  if (!rule) notFound();

  const [categories, accounts] = await Promise.all([
    listCategories([scope.entity.id]),
    listAccounts([scope.entity.id], { includeInactive: true }),
  ]);

  return (
    <>
      <PageHeader
        title="Editar regra"
        description={`${rule.hitCount} lançamento${rule.hitCount === 1 ? "" : "s"} já ${rule.hitCount === 1 ? "foi categorizado" : "foram categorizados"} por ela`}
      />
      <RuleForm slug={slug} rule={rule} categories={categories} accounts={accounts} />
      <div className="mt-10">
        <DeleteRule slug={slug} id={rule.id} />
      </div>
    </>
  );
}
