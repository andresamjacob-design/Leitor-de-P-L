import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { CategoryForm } from "../category-form";
import { getCategory, listCategories } from "@/lib/data/categories";
import { resolveScope } from "@/lib/entities";

export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity: slug, id } = await params;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  const category = await getCategory(id);
  if (!category) notFound();

  const categories = await listCategories([category.entityId], { includeInactive: true });

  return (
    <>
      <PageHeader title={`${category.code} · ${category.name}`} description="Editar categoria" />
      <CategoryForm slug={slug} category={category} categories={categories} />
    </>
  );
}
