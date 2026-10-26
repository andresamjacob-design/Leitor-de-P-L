import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Table, TableScroll, Td, Th } from "@/components/ui/table";
import { listarAcessos, PAPEL_DESCRICAO, PAPEL_LABEL } from "@/lib/data/acessos";
import { resolveScope } from "@/lib/entities";
import { MudarAcessoForm, NovoAcessoForm } from "./acesso-form";

const DESCRICAO = "Quem pode ver e editar os dados desta empresa. Só administradores mudam isto.";

export default async function AcessosPage({ params }: { params: Promise<{ entity: string }> }) {
  const { entity: slug } = await params;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  if (scope.kind === "consolidated") {
    return <ConsolidatedNotice title="Acessos" description={DESCRICAO} entities={scope.entities} path="acessos" />;
  }

  const acessos = await listarAcessos(scope.entity.id);

  return (
    <>
      <PageHeader title="Acessos" description={DESCRICAO} />

      {acessos === null ? (
        <EmptyState title="Só administradores veem esta página">
          Se você precisa liberar alguém, peça a um administrador.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Liberar uma pessoa</h2>
            <p className="text-sm text-muted">
              Qualquer e-mail @ddgroup.com.br consegue entrar com o código, mas só vê os dados
              quem estiver liberado aqui. A pessoa não precisa ter entrado antes: a liberação
              vale no primeiro login.
            </p>
            <NovoAcessoForm slug={slug} />
            <ul className="text-xs text-muted">
              {(["viewer", "member", "owner"] as const).map((p) => (
                <li key={p}>
                  <strong>{PAPEL_LABEL[p]}</strong>: {PAPEL_DESCRICAO[p]}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Quem tem acesso</h2>
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <Th>E-mail</Th>
                    <Th>Situação</Th>
                    <Th>Último login</Th>
                    <Th>Acesso</Th>
                  </tr>
                </thead>
                <tbody>
                  {acessos.map((a) => (
                    <tr key={`${a.email}-${a.situacao}`}>
                      <Td>{a.email}</Td>
                      <Td>
                        <span className={a.situacao === "sem acesso" ? "text-amber-700 dark:text-amber-400" : ""}>
                          {a.situacao}
                        </span>
                      </Td>
                      <Td>
                        {a.ultimoAcesso
                          ? new Date(a.ultimoAcesso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
                          : "—"}
                      </Td>
                      <Td>
                        <MudarAcessoForm slug={slug} email={a.email} papel={a.papel} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </section>
        </div>
      )}
    </>
  );
}
