import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableScroll, Td, Th } from "@/components/ui/table";
import { countEntriesByCategory, listCategories } from "@/lib/data/categories";
import { resolveScope } from "@/lib/entities";
import { CATEGORY_KIND_LABEL, DRE_GROUP_LABEL } from "@/lib/ledger-types";

export default async function ChartOfAccountsPage({
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
        title="Plano de contas"
        description="As linhas do fluxo de caixa e do DRE."
        entities={scope.entities}
        path="plano-de-contas"
      />
    );
  }

  const categories = await listCategories([scope.entity.id], { includeInactive: true });
  const usage = await countEntriesByCategory(categories.map((category) => category.id));

  // Grouped the way the `DRE Geral` sheet groups them, in its own order.
  const groups = new Map<string, typeof categories>();
  for (const category of categories) {
    const key = category.dreGroup ?? "";
    groups.set(key, [...(groups.get(key) ?? []), category]);
  }

  return (
    <>
      <PageHeader
        title="Plano de contas"
        description="As linhas do fluxo de caixa e, na Fase 6, do DRE gerencial."
      />

      <div className="mb-4 flex justify-end">
        <Link
          href={`/${slug}/plano-de-contas/nova`}
          className={buttonVariants({ size: "sm" })}
        >
          Nova categoria
        </Link>
      </div>

      {categories.length === 0 ? (
        <EmptyState title="Plano de contas vazio">
          Rode <code className="font-mono">npm run db:seed</code> para criar o plano
          derivado da planilha, ou crie as categorias à mão.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          {[...groups].map(([group, rows]) => (
            <section key={group}>
              <h2 className="mb-2 text-sm font-medium">
                {DRE_GROUP_LABEL[group] ?? "Sem grupo"}
              </h2>
              <TableScroll>
                <Table>
                  <thead>
                    <tr>
                      <Th className="w-24">Código</Th>
                      <Th>Nome</Th>
                      <Th>Natureza</Th>
                      <Th numeric>Lançamentos</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((category) => (
                      <tr key={category.id} className={category.active ? "" : "opacity-50"}>
                        <Td className="tabular text-xs text-muted">{category.code}</Td>
                        <Td>
                          <Link
                            href={`/${slug}/plano-de-contas/${category.id}`}
                            className={category.parentId ? "pl-4 text-accent hover:underline" : "text-accent hover:underline"}
                          >
                            {category.name}
                          </Link>
                          {category.active ? null : (
                            <span className="ml-2 text-xs text-muted">inativa</span>
                          )}
                        </Td>
                        <Td className="text-xs text-muted">
                          {CATEGORY_KIND_LABEL[category.kind]}
                        </Td>
                        <Td numeric className="text-xs text-muted">
                          {usage.get(category.id) ?? 0}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
