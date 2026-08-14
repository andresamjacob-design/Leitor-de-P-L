import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableScroll, Td, Th } from "@/components/ui/table";
import { listClients, listPeopleRecords } from "@/lib/data/clients";
import { resolveScope } from "@/lib/entities";

const KIND_LABEL: Record<string, string> = {
  employee: "colaborador",
  contractor: "prestador",
  partner: "sócio",
};

const BOND_LABEL: Record<string, string> = {
  clt: "CLT",
  pj: "PJ",
  freelancer: "Freelancer",
  estagio: "Estágio",
  socio: "Sócio",
};

export default async function PeoplePage({
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
        title="Pessoas"
        description="Quem trabalha, e como o extrato reconhece um salário."
        entities={scope.entities}
        path="pessoas"
      />
    );
  }

  const [people, clients] = await Promise.all([
    listPeopleRecords([scope.entity.id], { includeInactive: true }),
    listClients([scope.entity.id], { includeInactive: true }),
  ]);

  const clientById = new Map(clients.map((client) => [client.id, client]));

  return (
    <>
      <PageHeader
        title="Pessoas"
        description="Cadastrar o nome é o que faz um PIX de salário ser reconhecido sozinho no extrato."
      />

      <div className="mb-4 flex justify-end">
        <Link href={`/${slug}/pessoas/nova`} className={buttonVariants({ size: "sm" })}>
          Nova pessoa
        </Link>
      </div>

      {people.length === 0 ? (
        <EmptyState title="Nenhuma pessoa cadastrada">
          Sem nomes cadastrados, a folha continua sendo categorizada à mão.
        </EmptyState>
      ) : (
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Cargo</Th>
                <Th>Vínculo</Th>
                <Th>Squad</Th>
                <Th>Cliente</Th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id} className={person.active ? "" : "opacity-50"}>
                  <Td>
                    <Link href={`/${slug}/pessoas/${person.id}`} className="text-accent hover:underline">
                      {person.name}
                    </Link>
                    <span className="ml-2 text-xs text-muted">
                      {KIND_LABEL[person.kind] ?? person.kind}
                    </span>
                  </Td>
                  <Td className="text-xs text-muted">{person.role ?? "—"}</Td>
                  <Td className="text-xs text-muted">
                    {person.bond ? (BOND_LABEL[person.bond] ?? person.bond) : "—"}
                  </Td>
                  <Td className="text-xs text-muted">{person.squad ?? "—"}</Td>
                  <Td className="text-xs text-muted">
                    {person.clientId ? (clientById.get(person.clientId)?.name ?? "—") : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
    </>
  );
}
