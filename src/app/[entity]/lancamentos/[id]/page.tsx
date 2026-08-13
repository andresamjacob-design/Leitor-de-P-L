import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Table, TableScroll, Td, Th } from "@/components/ui/table";
import { EntryForm } from "../entry-form";
import { DeleteEntry } from "../delete-entry";
import { listAccounts } from "@/lib/data/accounts";
import { listCategories } from "@/lib/data/categories";
import { getCashEntry, getTransferPair } from "@/lib/data/cash-entries";
import { listRecognitionForCashEntry } from "@/lib/data/recognition";
import { changedFields, listAuditFor } from "@/lib/data/audit";
import { resolveScope } from "@/lib/entities";
import { formatPeriod, formatPtBRDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

const ACTION_LABEL: Record<string, string> = {
  insert: "criado",
  update: "editado",
  delete: "apagado",
};

const FIELD_LABEL: Record<string, string> = {
  account_id: "conta",
  occurred_on: "data",
  competence_period: "competência",
  amount: "valor",
  direction: "sentido",
  description: "descrição",
  category_id: "categoria",
  client_id: "cliente",
  person_id: "pessoa",
  vendor: "fornecedor",
  is_intercompany: "intercompany",
};

export default async function EditEntryPage({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity: slug, id } = await params;
  const scope = await resolveScope(slug);
  if (!scope) notFound();

  const entry = await getCashEntry(id);
  if (!entry) notFound();

  const [accounts, categories, pair, recognitions, audit] = await Promise.all([
    listAccounts([entry.entityId], { includeInactive: true }),
    listCategories([entry.entityId], { includeInactive: true }),
    getTransferPair(entry.id),
    listRecognitionForCashEntry(entry.id),
    listAuditFor("cash_entries", entry.id),
  ]);

  const categoryById = new Map(categories.map((category) => [category.id, category]));

  return (
    <>
      <PageHeader
        title={entry.description}
        description={`${formatPtBRDate(entry.occurredOn)} · ${formatMoney(entry.amount)}`}
      />

      <EntryForm
        slug={slug}
        entry={entry}
        accounts={accounts}
        categories={categories}
        counterpartAccountId={pair?.toAccountId ?? null}
      />

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-medium">Competência</h2>
        {recognitions.length === 0 ? (
          <p className="text-sm text-muted">
            Este lançamento não gera linha de competência. Receita vem do contrato, e
            transferência não é resultado.
          </p>
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>Mês</Th>
                  <Th>Categoria</Th>
                  <Th>Origem</Th>
                  <Th numeric>Valor</Th>
                </tr>
              </thead>
              <tbody>
                {recognitions.map((recognition) => (
                  <tr key={recognition.id}>
                    <Td>{formatPeriod(recognition.period)}</Td>
                    <Td className="text-xs text-muted">
                      {categoryById.get(recognition.categoryId)?.name ?? "—"}
                    </Td>
                    <Td className="text-xs text-muted">
                      {recognition.source === "cash_mirror" ? "espelho do caixa" : recognition.source}
                      {recognition.manuallyEdited ? " · editada à mão" : ""}
                    </Td>
                    <Td numeric>{formatMoney(recognition.amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-2 text-sm font-medium">Histórico</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-muted">Sem histórico registrado.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {audit.map((event) => {
              const changes = changedFields(event.beforeJson, event.afterJson);
              return (
                <li key={event.id} className="rounded-md border border-border px-3 py-2">
                  <p className="text-xs text-muted tabular">
                    {new Date(event.createdAt).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                    })}{" "}
                    · {ACTION_LABEL[event.action] ?? event.action} por{" "}
                    {event.actor === "system" ? "sistema" : event.actor}
                  </p>
                  {changes.length > 0 ? (
                    <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                      {changes.map((change) => (
                        <li key={change.field}>
                          <span className="text-muted">
                            {FIELD_LABEL[change.field] ?? change.field}:
                          </span>{" "}
                          {String(change.from ?? "—")} → {String(change.to ?? "—")}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <DeleteEntry slug={slug} id={entry.id} pairedNotice={pair?.toCashEntryId != null} />
      </section>
    </>
  );
}
