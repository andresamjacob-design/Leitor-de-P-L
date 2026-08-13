import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import type { Entity } from "@/lib/entity-types";

/**
 * Consolidado is a reading lens, not a place to save into: a lançamento belongs to one
 * CNPJ, and "as duas somadas" is not a CNPJ. Reports work consolidated; forms do not.
 */
export function ConsolidatedNotice({
  title,
  description,
  entities,
  path,
}: {
  title: string;
  description: string;
  entities: Entity[];
  /** The screen to land on, e.g. `contas`. */
  path: string;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState title="Escolha uma entidade">
        O consolidado é só de leitura — um lançamento pertence a um CNPJ.{" "}
        {entities.map((entity, index) => (
          <span key={entity.id}>
            {index > 0 ? " · " : ""}
            <Link
              href={`/${entity.slug}/${path}`}
              className="text-accent underline underline-offset-2"
            >
              {entity.name}
            </Link>
          </span>
        ))}
      </EmptyState>
    </>
  );
}
