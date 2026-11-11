import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { ExportLinks } from "@/components/export-links";
import { CategoryPicker } from "./category-picker";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Amount, Table, TableScroll, Td, Th } from "@/components/ui/table";
import { listAccounts } from "@/lib/data/accounts";
import { listCategories } from "@/lib/data/categories";
import { listClients } from "@/lib/data/clients";
import { listCashEntries } from "@/lib/data/cash-entries";
import { resolveScope } from "@/lib/entities";
import { formatPeriodShort, formatPtBRDate, todayInSaoPaulo } from "@/lib/dates";
import { formatMoney, sum } from "@/lib/money";
import { competenceOf, hasCompetenceOverride } from "@/lib/recognition/mirror";
import type { EntryDirection } from "@/lib/ledger-types";
import { clientePorCnpj } from "@/lib/cliente-por-cnpj";

type Search = {
  de?: string;
  ate?: string;
  conta?: string;
  categoria?: string;
  sentido?: string;
  busca?: string;
};

export default async function EntriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<Search>;
}) {
  const { entity: slug } = await params;
  const search = await searchParams;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  const entities = scope.kind === "consolidated" ? scope.entities : [scope.entity];
  const entityIds = entities.map((entity) => entity.id);
  const year = todayInSaoPaulo().slice(0, 4);

  const from = search.de || `${year}-01-01`;
  const to = search.ate || `${year}-12-31`;

  const [accounts, categories, clients] = await Promise.all([
    listAccounts(entityIds, { includeInactive: true }),
    listCategories(entityIds, { includeInactive: true }),
    listClients(entityIds),
  ]);

  // A drill-down from the consolidated cash flow sends a chart-of-accounts code, because
  // there the same line exists once per entity. A single entity sends the id itself.
  const selected = search.categoria ?? "";
  const byCode = categories.filter((category) => category.code === selected);
  const categoryFilter =
    selected === "none"
      ? { categoryId: "none" as const }
      : byCode.length > 0
        ? { categoryIds: byCode.map((category) => category.id) }
        : selected
          ? { categoryId: selected }
          : {};

  const entries = await listCashEntries({
    entityIds,
    from,
    to,
    accountIds: search.conta ? [search.conta] : undefined,
    direction:
      search.sentido === "in" || search.sentido === "out"
        ? (search.sentido as EntryDirection)
        : undefined,
    search: search.busca,
    ...categoryFilter,
  });

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  // The inline picker only exists for one entity (the consolidated view is read-only) and
  // leaves transfers out: those need a counterpart account, asked by the full form.
  const pickable =
    scope.kind === "entity"
      ? categories
          .filter((category) => category.active && category.kind !== "transfer")
          .map(({ id, code, name, kind }) => ({ id, code, name, kind }))
      : null;
  const pickableClients = clients.map(({ id, name }) => ({ id, name }));
  // A receipt from a CNPJ that is a registered client arrives with that client chosen.
  const clientByTaxId = clientePorCnpj(clients);

  const inflow = sum(
    entries.filter((entry) => entry.direction === "in").map((entry) => entry.amount),
  );
  const outflow = sum(
    entries.filter((entry) => entry.direction === "out").map((entry) => entry.amount),
  );

  return (
    <>
      <PageHeader
        title="Lançamentos"
        description="Regime de caixa: o dia em que o dinheiro se moveu de verdade."
      />

      <div className="mb-6 flex justify-end">
        <ExportLinks slug={slug} report="lancamentos" />
      </div>

      <form method="get" className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="De" htmlFor="de">
          <Input id="de" name="de" type="date" defaultValue={from} />
        </Field>
        <Field label="Até" htmlFor="ate">
          <Input id="ate" name="ate" type="date" defaultValue={to} />
        </Field>
        <Field label="Conta" htmlFor="conta">
          <Select id="conta" name="conta" defaultValue={search.conta ?? ""}>
            <option value="">Todas</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Categoria" htmlFor="categoria">
          <Select id="categoria" name="categoria" defaultValue={selected}>
            <option value="">Todas</option>
            <option value="none">Sem categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.code} · {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sentido" htmlFor="sentido">
          <Select id="sentido" name="sentido" defaultValue={search.sentido ?? ""}>
            <option value="">Todos</option>
            <option value="in">Entrada</option>
            <option value="out">Saída</option>
          </Select>
        </Field>
        <Field label="Descrição" htmlFor="busca">
          <Input id="busca" name="busca" defaultValue={search.busca ?? ""} placeholder="pix" />
        </Field>
        <div className="flex items-end gap-3 sm:col-span-3 lg:col-span-6">
          <Button type="submit" variant="outline" size="sm">
            Filtrar
          </Button>
          <Link href={`/${slug}/lancamentos`} className="text-sm text-muted hover:text-foreground">
            Limpar
          </Link>
          {scope.kind === "entity" ? (
            <Link
              href={`/${slug}/lancamentos/novo`}
              className={buttonVariants({ size: "sm", className: "ml-auto" })}
            >
              Novo lançamento
            </Link>
          ) : null}
        </div>
      </form>

      {entries.length === 0 ? (
        <EmptyState title="Nenhum lançamento neste filtro">
          {scope.kind === "consolidated"
            ? "O consolidado só lê. Escolha uma entidade para lançar."
            : "Comece pelo primeiro lançamento, ou importe um extrato na Fase 3."}
        </EmptyState>
      ) : (
        <>
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th className="w-28">Data</Th>
                  <Th>Descrição</Th>
                  <Th>Conta</Th>
                  <Th>Categoria</Th>
                  <Th className="w-24">Competência</Th>
                  <Th numeric className="w-32">
                    Valor
                  </Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const category = entry.categoryId
                    ? categoryById.get(entry.categoryId)
                    : undefined;
                  const overridden = hasCompetenceOverride(entry);

                  return (
                    <tr key={entry.id}>
                      <Td className="whitespace-nowrap tabular text-xs">
                        {formatPtBRDate(entry.occurredOn)}
                      </Td>
                      <Td>
                        <Link
                          href={`/${slug}/lancamentos/${entry.id}`}
                          className="text-accent hover:underline"
                        >
                          {entry.description}
                        </Link>
                        {entry.updatedAt ? (
                          <span className="ml-2 text-xs text-muted">editado</span>
                        ) : null}
                      </Td>
                      <Td className="text-xs text-muted">
                        {accountById.get(entry.accountId)?.name ?? "—"}
                      </Td>
                      <Td className="text-xs text-muted">
                        {pickable &&
                        (!category ||
                          (entry.direction === "in" &&
                            category.kind === "revenue" &&
                            // Só receita de cliente pede cliente; rendimento de aplicação
                            // também é "revenue", mas fica nas Financeiras.
                            category.dreGroup === "receita_bruta" &&
                            entry.clientId === null)) ? (
                          <>
                            {category ? (
                              <span className="mb-1 block">
                                {category.code} · {category.name} · sem cliente
                              </span>
                            ) : null}
                            <CategoryPicker
                              slug={slug}
                              entryId={entry.id}
                              direction={entry.direction}
                              categories={pickable}
                              clients={pickableClients}
                              defaultCategoryId={category?.id ?? ""}
                              defaultClientId={
                                clientByTaxId(entry.counterpartyTaxId) ?? ""
                              }
                            />
                          </>
                        ) : category ? (
                          `${category.code} · ${category.name}`
                        ) : (
                          "Sem categoria"
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        <span className={overridden ? "text-accent" : "text-muted"}>
                          {formatPeriodShort(competenceOf(entry))}
                        </span>
                      </Td>
                      <Td numeric>
                        <Amount
                          value={entry.direction === "in" ? entry.amount : -entry.amount}
                          format={formatMoney}
                        />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableScroll>

          <p className="mt-3 text-xs text-muted tabular">
            {entries.length} lançamento{entries.length === 1 ? "" : "s"} · entradas{" "}
            {formatMoney(inflow)} · saídas {formatMoney(outflow)} · líquido{" "}
            {formatMoney(inflow - outflow)}. Este total é do filtro, incluindo cartão — o
            fluxo de caixa considera só as contas de dinheiro.
          </p>
        </>
      )}
    </>
  );
}
