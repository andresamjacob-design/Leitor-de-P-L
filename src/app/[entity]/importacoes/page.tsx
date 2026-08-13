import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Table, TableScroll, Td, Th } from "@/components/ui/table";
import { UploadForm } from "./upload-form";
import { listAccounts } from "@/lib/data/accounts";
import { listImports } from "@/lib/data/imports";
import { resolveScope } from "@/lib/entities";
import { formatPtBRDate } from "@/lib/dates";

const STATUS_LABEL: Record<string, string> = {
  parsing: "lendo",
  reviewing: "aguardando revisão",
  approved: "concluída",
  discarded: "descartada",
  failed: "falhou",
};

export default async function ImportsPage({
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
        title="Importações"
        description="Extrato do Itaú e fatura do cartão."
        entities={scope.entities}
        path="importacoes"
      />
    );
  }

  const [accounts, imports] = await Promise.all([
    listAccounts([scope.entity.id], { includeInactive: true }),
    listImports([scope.entity.id]),
  ]);

  const accountById = new Map(accounts.map((account) => [account.id, account]));

  return (
    <>
      <PageHeader
        title="Importações"
        description="Extrato do Itaú em xlsx/csv e fatura do cartão em pdf. Nada entra no ledger sem aprovação."
      />

      {accounts.length === 0 ? (
        <EmptyState title="Nenhuma conta cadastrada">
          Cadastre a conta corrente e o cartão antes de importar.
        </EmptyState>
      ) : (
        <div className="mb-8">
          <UploadForm slug={slug} accounts={accounts} />
        </div>
      )}

      <h2 className="mb-3 text-sm font-medium">Arquivos importados</h2>
      {imports.length === 0 ? (
        <EmptyState title="Nenhuma importação ainda">
          O primeiro arquivo importado aparece aqui, com o que foi aprovado e o que foi
          recusado.
        </EmptyState>
      ) : (
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th>Arquivo</Th>
                <Th>Conta</Th>
                <Th>Período</Th>
                <Th>Situação</Th>
                <Th>Importado em</Th>
              </tr>
            </thead>
            <tbody>
              {imports.map((record) => (
                <tr key={record.id} className={record.status === "discarded" ? "opacity-50" : ""}>
                  <Td>
                    <Link
                      href={`/${slug}/importacoes/${record.id}`}
                      className="text-accent hover:underline"
                    >
                      {record.filename}
                    </Link>
                    <span className="ml-2 text-xs uppercase text-muted">{record.format}</span>
                  </Td>
                  <Td className="text-xs text-muted">
                    {accountById.get(record.accountId)?.name ?? "—"}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted tabular">
                    {record.periodStart && record.periodEnd
                      ? `${formatPtBRDate(record.periodStart)} a ${formatPtBRDate(record.periodEnd)}`
                      : "—"}
                  </Td>
                  <Td className="text-xs">{STATUS_LABEL[record.status] ?? record.status}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted tabular">
                    {formatPtBRDate(record.createdAt.slice(0, 10))}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}

      <p className="mt-6 text-xs text-muted">
        O mesmo arquivo não é importado duas vezes: a conferência é pelo conteúdo, não pelo
        nome. Linhas que já existem no ledger chegam marcadas como duplicata — é o que
        permite reimportar um período que se sobrepõe ao anterior sem medo.
      </p>
    </>
  );
}
