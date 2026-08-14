import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableScroll, Td, Th } from "@/components/ui/table";
import { RunEngine } from "./run-engine";
import { listAccounts } from "@/lib/data/accounts";
import { listCategories } from "@/lib/data/categories";
import { listCashEntries } from "@/lib/data/cash-entries";
import { listRules } from "@/lib/data/rules";
import { resolveScope } from "@/lib/entities";
import { formatMoney } from "@/lib/money";
import { formatTaxId } from "@/lib/tax-id";

const MATCH_LABEL: Record<string, string> = {
  contains: "contém",
  exact: "é exatamente",
  regex: "regex",
  amount_range: "faixa de valor",
};

export default async function RulesPage({
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
        title="Regras"
        description="Como o sistema decide a categoria de um lançamento."
        entities={scope.entities}
        path="regras"
      />
    );
  }

  const [rules, categories, accounts, uncategorized] = await Promise.all([
    listRules([scope.entity.id], { includeInactive: true }),
    listCategories([scope.entity.id], { includeInactive: true }),
    listAccounts([scope.entity.id], { includeInactive: true }),
    listCashEntries({ entityIds: [scope.entity.id], categoryId: "none", limit: 5000 }),
  ]);

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  return (
    <>
      <PageHeader
        title="Regras"
        description="Como o sistema decide a categoria de um lançamento. Nenhuma IA envolvida."
      />

      <div className="mb-6">
        <RunEngine slug={slug} uncategorized={uncategorized.length} />
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium">Regras cadastradas</h2>
        <Link href={`/${slug}/regras/nova`} className={buttonVariants({ size: "sm" })}>
          Nova regra
        </Link>
      </div>

      {rules.length === 0 ? (
        <EmptyState title="Nenhuma regra ainda">
          Você não precisa criar nenhuma para começar: o sistema já reusa o que foi
          decidido antes, pelo CNPJ da contraparte e pela descrição. Uma regra serve para
          corrigir um caso que o histórico erraria, ou para pegar um fornecedor que
          escreve o nome de um jeito diferente todo mês.
        </EmptyState>
      ) : (
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th className="w-16">Ordem</Th>
                <Th>Quando</Th>
                <Th>Categoria</Th>
                <Th>Conta</Th>
                <Th numeric className="w-20">
                  Acertos
                </Th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const category = categoryById.get(rule.categoryId);
                const range =
                  rule.amountMin !== null || rule.amountMax !== null
                    ? ` entre ${rule.amountMin === null ? "0,00" : formatMoney(rule.amountMin)} e ${
                        rule.amountMax === null ? "∞" : formatMoney(rule.amountMax)
                      }`
                    : "";

                return (
                  <tr key={rule.id} className={rule.active ? "" : "opacity-50"}>
                    <Td className="tabular text-xs text-muted">{rule.priority}</Td>
                    <Td>
                      <Link
                        href={`/${slug}/regras/${rule.id}`}
                        className="text-accent hover:underline"
                      >
                        {rule.counterpartyTaxId
                          ? `CNPJ ${formatTaxId(rule.counterpartyTaxId)}`
                          : `${MATCH_LABEL[rule.matchType] ?? rule.matchType} “${rule.pattern}”`}
                      </Link>
                      <span className="text-xs text-muted">{range}</span>
                      {rule.active ? null : (
                        <span className="ml-2 text-xs text-muted">inativa</span>
                      )}
                    </Td>
                    <Td className="text-xs">
                      {category ? `${category.code} · ${category.name}` : "—"}
                    </Td>
                    <Td className="text-xs text-muted">
                      {rule.accountId ? (accountById.get(rule.accountId)?.name ?? "—") : "todas"}
                    </Td>
                    <Td numeric className="text-xs text-muted">
                      {rule.hitCount}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
      )}

      <section className="mt-8 text-xs text-muted">
        <h3 className="mb-2 text-sm font-medium text-foreground">A ordem da decisão</h3>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          <li>Regra amarrada ao CNPJ da contraparte.</li>
          <li>Regra por texto ou faixa de valor, na ordem de prioridade.</li>
          <li>O que foi feito da última vez com esse mesmo CNPJ.</li>
          <li>O que foi feito da última vez com essa mesma descrição.</li>
          <li>O nome de uma pessoa cadastrada aparecendo na descrição.</li>
        </ol>
        <p className="mt-2">
          Identidade ganha de texto porque o extrato traz o CNPJ, e o mesmo nome pode ser
          cliente e fornecedor ao mesmo tempo. Regra ganha de histórico porque é assim que
          se corrige um erro que o histórico repetiria para sempre.
        </p>
      </section>
    </>
  );
}
