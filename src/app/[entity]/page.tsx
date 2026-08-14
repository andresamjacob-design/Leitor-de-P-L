import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Amount } from "@/components/ui/table";
import { accountBalances, listAccounts } from "@/lib/data/accounts";
import { listCashEntries } from "@/lib/data/cash-entries";
import { listContracts, listRecognitionForContract } from "@/lib/data/contracts";
import { loadPl } from "@/lib/data/pl-report";
import { detectRecurring, totalMonthly } from "@/lib/categorize/recurrence";
import { deferredRevenue } from "@/lib/recognition/engine";
import { findLine } from "@/lib/pl";
import { resolveScope } from "@/lib/entities";
import { formatPeriod, periodOf, todayInSaoPaulo } from "@/lib/dates";
import { formatMoney, mulRatio, sum, type Cents } from "@/lib/money";
import { isCashAccount } from "@/lib/ledger-types";

/**
 * The overview.
 *
 * Only realised figures — no targets (D3). Every number links to the screen that explains
 * it, because a dashboard whose figures cannot be opened is a dashboard nobody trusts.
 * A figure that cannot be computed shows a dash and the reason (SPEC §14), never a zero
 * standing in for "unknown".
 */
export default async function OverviewPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity: slug } = await params;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  const entities = scope.kind === "consolidated" ? scope.entities : [scope.entity];
  const entityIds = entities.map((entity) => entity.id);

  const today = todayInSaoPaulo();
  const thisMonth = periodOf(today);

  const [accounts, { report }, contracts, outflows, uncategorized] = await Promise.all([
    listAccounts(entityIds, { includeInactive: true }),
    loadPl({
      entityIds,
      entities: entities.map((entity) => ({ id: entity.id, name: entity.name })),
      from: thisMonth,
      to: thisMonth,
      consolidated: false,
    }),
    listContracts(entityIds),
    listCashEntries({ entityIds, direction: "out", limit: 20000 }),
    listCashEntries({ entityIds, categoryId: "none", limit: 5000 }),
  ]);

  const cashAccounts = accounts.filter((account) => isCashAccount(account.type));
  const balances = await accountBalances(cashAccounts, { until: today });
  const cash = sum([...balances.values()]);

  const revenue = findLine(report, "group-receita_bruta")?.values[0] ?? 0n;
  const ebitda = findLine(report, "ebitda")?.values[0] ?? 0n;
  const result = findLine(report, "result")?.values[0] ?? 0n;

  const backlog = await Promise.all(
    contracts
      .filter((contract) => contract.status === "active")
      .map(async (contract) => deferredRevenue(contract, await listRecognitionForContract(contract.id))),
  );
  const toRecognize = sum(
    backlog.map((item) => item.deferred).filter((value): value is Cents => value !== null && value > 0n),
  );

  const subscriptions = detectRecurring(
    outflows.map((entry) => ({
      id: entry.id,
      description: entry.description,
      amount: entry.amount,
      occurredOn: entry.occurredOn,
      categoryId: entry.categoryId,
      accountId: entry.accountId,
    })),
    { today },
  );

  const cards = [
    {
      label: `Receita de ${formatPeriod(thisMonth)}`,
      value: revenue,
      href: `/${slug}/dre`,
      hint: "reconhecida, em competência",
    },
    {
      label: "EBITDA do mês",
      value: ebitda,
      href: `/${slug}/dre`,
      hint:
        revenue === 0n
          ? "sem receita no mês"
          : `${formatMoney(mulRatio(ebitda, 10000n, revenue))}% da receita`,
    },
    {
      label: "Resultado do mês",
      value: result,
      href: `/${slug}/dre`,
      hint: "depois de sócios",
    },
    {
      label: "Caixa hoje",
      value: cash,
      href: `/${slug}/fluxo-de-caixa`,
      hint: `${cashAccounts.length} conta${cashAccounts.length === 1 ? "" : "s"} de dinheiro`,
    },
    {
      label: "A reconhecer",
      value: toRecognize,
      href: `/${slug}/receita`,
      hint: `${backlog.length} contrato${backlog.length === 1 ? "" : "s"} ativo${backlog.length === 1 ? "" : "s"}`,
    },
    {
      label: "Assinaturas por mês",
      value: totalMonthly(subscriptions),
      href: `/${slug}/assinaturas`,
      hint: `${subscriptions.filter((item) => item.active).length} ativas`,
    },
  ];

  return (
    <>
      <PageHeader
        title="Visão geral"
        description={
          scope.kind === "consolidated"
            ? "As duas entidades somadas."
            : scope.entity.legalName
        }
      />

      {accounts.length === 0 ? (
        <EmptyState title="Nenhuma conta cadastrada">
          Rode <code className="font-mono">npm run db:seed</code>, ou cadastre a conta
          corrente em <Link href={`/${slug}/contas`} className="text-accent underline underline-offset-2">Contas</Link>.
        </EmptyState>
      ) : (
        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.label}
              href={card.href}
              className="rounded-lg border border-border p-4 transition-colors hover:bg-surface"
            >
              <p className="text-xs text-muted">{card.label}</p>
              <p className="tabular mt-1 text-xl font-semibold">
                <Amount value={card.value} format={formatMoney} />
              </p>
              <p className="mt-1 text-xs text-muted">{card.hint}</p>
            </Link>
          ))}
        </section>
      )}

      {uncategorized.length > 0 ? (
        <p className="mb-8 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {uncategorized.length} lançamento{uncategorized.length === 1 ? "" : "s"} sem
          categoria — {uncategorized.length === 1 ? "ele não aparece" : "eles não aparecem"}{" "}
          em nenhuma linha do DRE.{" "}
          <Link href={`/${slug}/regras`} className="underline underline-offset-2">
            Categorizar
          </Link>
          .
        </p>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium">Contas</h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {accounts.map((account) => (
            <li key={account.id} className="flex items-baseline justify-between gap-4 px-4 py-3">
              <span className="text-sm">
                {account.name}
                {account.active ? null : <span className="ml-2 text-xs text-muted">inativa</span>}
              </span>
              <span className="tabular text-sm">
                {isCashAccount(account.type) ? (
                  <Amount value={balances.get(account.id) ?? 0n} format={formatMoney} />
                ) : (
                  <span className="text-muted">cartão</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-muted">
        Todos os números são realizados — o sistema não guarda meta nem orçamento (D3).
        Receita e resultado são de competência; caixa é a data real do dinheiro. Os dois não
        fecham entre si, e{" "}
        <Link href={`/${slug}/dre`} className="text-accent underline underline-offset-2">
          o DRE mostra a diferença
        </Link>
        .
      </p>
    </>
  );
}
