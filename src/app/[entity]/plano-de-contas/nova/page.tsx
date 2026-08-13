import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { PageHeader } from "@/components/page-header";
import { CategoryForm } from "../category-form";
import { listCategories } from "@/lib/data/categories";
import { resolveScope } from "@/lib/entities";

export default async function NewCategoryPage({
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
        title="Nova categoria"
        description="Uma categoria pertence a uma entidade."
        entities={scope.entities}
        path="plano-de-contas/nova"
      />
    );
  }

  const categories = await listCategories([scope.entity.id], { includeInactive: true });

  return (
    <>
      <PageHeader title="Nova categoria" description={scope.entity.name} />
      <CategoryForm slug={slug} category={null} categories={categories} />
    </>
  );
}
