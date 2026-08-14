import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import {
  ACTION_LABEL,
  TABLE_LABEL,
  changedFields,
  describeValue,
  listAudit,
} from "@/lib/data/audit";
import { resolveScope } from "@/lib/entities";
import { todayInSaoPaulo } from "@/lib/dates";

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
  contract_id: "contrato",
  vendor: "fornecedor",
  is_intercompany: "intercompany",
  period: "mês",
  kind: "tipo",
  source: "origem",
  manually_edited: "editada à mão",
  status: "situação",
  total_value: "valor total",
  monthly_value: "valor mensal",
  start_date: "início",
  end_date: "fim",
  pattern: "padrão",
  priority: "prioridade",
  active: "ativa",
};

/** Where each table's row lives, so a log line can be opened. */
const ROW_PATH: Record<string, string> = {
  cash_entries: "lancamentos",
  contracts: "contratos",
  categorization_rules: "regras",
};

type Search = { tabela?: string; ator?: string; de?: string; ate?: string };

export default async function AuditPage({
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
  const today = todayInSaoPaulo();
  const from = search.de || `${today.slice(0, 4)}-01-01`;
  const to = search.ate || today;

  const events = await listAudit({
    entityIds: entities.map((entity) => entity.id),
    tableName: search.tabela || undefined,
    actor: search.ator || undefined,
    from,
    to,
  });

  const actors = [...new Set(events.map((event) => event.actor))].sort();

  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Nada neste sistema trava. É este registro que torna isso seguro — toda alteração fica aqui, com o antes e o depois."
      />

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <Field label="De" htmlFor="de">
          <Input id="de" name="de" type="date" defaultValue={from} />
        </Field>
        <Field label="Até" htmlFor="ate">
          <Input id="ate" name="ate" type="date" defaultValue={to} />
        </Field>
        <Field label="Tabela" htmlFor="tabela">
          <Select id="tabela" name="tabela" defaultValue={search.tabela ?? ""}>
            <option value="">Todas</option>
            {Object.entries(TABLE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quem" htmlFor="ator">
          <Select id="ator" name="ator" defaultValue={search.ator ?? ""}>
            <option value="">Todos</option>
            {actors.map((actor) => (
              <option key={actor} value={actor}>
                {actor === "system" ? "sistema" : actor.slice(0, 8)}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="outline" size="sm">
          Filtrar
        </Button>
        <Link href={`/${slug}/auditoria`} className="text-sm text-muted hover:text-foreground">
          Limpar
        </Link>
      </form>

      {events.length === 0 ? (
        <EmptyState title="Nenhuma alteração neste período">
          O registro é escrito por gatilho no banco, não pela aplicação — se não há linha
          aqui, nada foi alterado.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((event) => {
            const changes = changedFields(event.beforeJson, event.afterJson);
            const path = event.tableName ? ROW_PATH[event.tableName] : undefined;
            const snapshot = event.afterJson ?? event.beforeJson;
            const label =
              typeof snapshot?.description === "string"
                ? snapshot.description
                : typeof snapshot?.name === "string"
                  ? snapshot.name
                  : (event.rowId?.slice(0, 8) ?? "");

            return (
              <li key={event.id} className="rounded-md border border-border px-3 py-2">
                <p className="text-xs text-muted">
                  <span className="tabular">
                    {new Date(event.createdAt).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                    })}
                  </span>{" "}
                  · {event.actor === "system" ? "o sistema" : event.actor.slice(0, 8)}{" "}
                  {ACTION_LABEL[event.action] ?? event.action} em{" "}
                  {event.tableName ? (TABLE_LABEL[event.tableName] ?? event.tableName) : "—"}
                </p>

                <p className="mt-0.5 text-sm">
                  {path && event.rowId && event.action !== "delete" ? (
                    <Link
                      href={`/${slug}/${path}/${event.rowId}`}
                      className="text-accent hover:underline"
                    >
                      {label}
                    </Link>
                  ) : (
                    label
                  )}
                </p>

                {event.action === "update" && changes.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                    {changes.map((change) => (
                      <li key={change.field}>
                        <span className="text-muted">
                          {FIELD_LABEL[change.field] ?? change.field}:
                        </span>{" "}
                        <span className="text-muted line-through">
                          {describeValue(change.field, change.from)}
                        </span>{" "}
                        → {describeValue(change.field, change.to)}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {event.action === "update" && changes.length === 0 ? (
                  <p className="mt-1 text-xs text-muted">
                    Nenhum campo de negócio mudou — só carimbo de data.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-xs text-muted">
        Mostrando até 500 alterações. O registro é somente leitura: a aplicação não tem
        como escrever nem apagar uma linha daqui.
      </p>
    </>
  );
}
