import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsolidatedNotice } from "@/components/consolidated-notice";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Amount, Table, TableScroll, Td, Th } from "@/components/ui/table";
import { accountBalances, listAccounts } from "@/lib/data/accounts";
import { resolveScope } from "@/lib/entities";
import { formatPtBRDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ACCOUNT_TYPE_LABEL, isCashAccount } from "@/lib/ledger-types";

export default async function AccountsPage({
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
        title="Contas"
        description="Onde o dinheiro fica, e de qual saldo o fluxo de caixa parte."
        entities={scope.entities}
        path="contas"
      />
    );
  }

  const accounts = await listAccounts([scope.entity.id], { includeInactive: true });
  const balances = await accountBalances(accounts);

  return (
    <>
      <PageHeader
        title="Contas"
        description="Onde o dinheiro fica, e de qual saldo o fluxo de caixa parte."
      />

      <div className="mb-4 flex justify-end">
        <Link href={`/${slug}/contas/nova`} className={buttonVariants({ size: "sm" })}>
          Nova conta
        </Link>
      </div>

      {accounts.length === 0 ? (
        <EmptyState title="Nenhuma conta cadastrada">
          Crie a conta corrente e o cartão antes de lançar qualquer movimento.
        </EmptyState>
      ) : (
        <TableScroll>
          <Table>
            <thead>
              <tr>
                <Th>Conta</Th>
                <Th>Tipo</Th>
                <Th>Identificação</Th>
                <Th numeric>Abertura</Th>
                <Th>Em</Th>
                <Th numeric>Saldo atual</Th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className={account.active ? "" : "opacity-50"}>
                  <Td>
                    <Link
                      href={`/${slug}/contas/${account.id}`}
                      className="text-accent hover:underline"
                    >
                      {account.name}
                    </Link>
                    {account.active ? null : (
                      <span className="ml-2 text-xs text-muted">inativa</span>
                    )}
                  </Td>
                  <Td>{ACCOUNT_TYPE_LABEL[account.type]}</Td>
                  <Td className="text-xs text-muted">
                    {[
                      account.institution,
                      account.branch ? `ag ${account.branch}` : null,
                      account.number,
                      account.lastDigits ? `final ${account.lastDigits}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </Td>
                  <Td numeric>
                    <Amount value={account.openingBalance} format={formatMoney} />
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted tabular">
                    {formatPtBRDate(account.openingDate)}
                  </Td>
                  <Td numeric>
                    <Amount value={balances.get(account.id) ?? 0n} format={formatMoney} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}

      <p className="mt-4 text-xs text-muted">
        O fluxo de caixa considera apenas contas de dinheiro de verdade —{" "}
        {accounts
          .filter((account) => isCashAccount(account.type))
          .map((account) => account.name)
          .join(", ") || "nenhuma ainda"}
        . O saldo de um cartão de crédito é dívida, não caixa: ele entra no DRE na data da
        compra e no caixa só quando a fatura é paga.
      </p>
    </>
  );
}
