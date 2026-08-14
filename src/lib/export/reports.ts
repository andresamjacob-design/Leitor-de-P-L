/**
 * Turning a report into rows.
 *
 * Every exporter calls the **same loader the screen calls** (SPEC §10: an export carries
 * the same numbers as the screen). Recomputing them here with slightly different filters
 * is exactly how an export starts disagreeing with the page it came from, so nothing here
 * does arithmetic — it only reshapes what the report already decided.
 */

import { loadCashFlow } from "@/lib/data/cash-flow-report";
import { compareLedgers, loadPl, listRecognition } from "@/lib/data/pl-report";
import { listCashEntries } from "@/lib/data/cash-entries";
import { listAccounts } from "@/lib/data/accounts";
import { listCategories } from "@/lib/data/categories";
import { listClients, listPeopleRecords } from "@/lib/data/clients";
import { listContracts, listRecognitionForContract } from "@/lib/data/contracts";
import { detectRecurring } from "@/lib/categorize/recurrence";
import { deferredRevenue } from "@/lib/recognition/engine";
import { periodRange } from "@/lib/cash-flow";
import { daysInMonth, formatPeriodShort, formatPtBRDate, type IsoDate, type Period } from "@/lib/dates";
import type { ExportSheet, ExportValue } from "@/lib/export/xlsx";
import type { Entity } from "@/lib/entity-types";

export const REPORTS = [
  "fluxo-de-caixa",
  "dre",
  "competencia",
  "lancamentos",
  "receita",
  "folha",
  "assinaturas",
] as const;

export type ReportName = (typeof REPORTS)[number];

export const REPORT_LABEL: Record<ReportName, string> = {
  "fluxo-de-caixa": "Fluxo de caixa",
  dre: "DRE gerencial",
  competencia: "Competência",
  lancamentos: "Lançamentos",
  receita: "Receita",
  folha: "Folha por pessoa",
  assinaturas: "Assinaturas",
};

export function isReportName(value: string): value is ReportName {
  return (REPORTS as readonly string[]).includes(value);
}

export type ReportRequest = {
  report: ReportName;
  entities: Entity[];
  consolidated: boolean;
  from: Period;
  to: Period;
};

function monthEnd(period: Period): IsoDate {
  return `${period.slice(0, 8)}${String(daysInMonth(period)).padStart(2, "0")}`;
}

function periodsOf(from: Period, to: Period): Period[] {
  return periodRange(from, monthEnd(to));
}

export async function buildReport(request: ReportRequest): Promise<ExportSheet[]> {
  const entityIds = request.entities.map((entity) => entity.id);

  switch (request.report) {
    case "fluxo-de-caixa":
      return cashFlowSheets(request, entityIds);
    case "dre":
      return plSheets(request, entityIds);
    case "competencia":
      return recognitionSheets(request, entityIds);
    case "lancamentos":
      return entrySheets(request, entityIds);
    case "receita":
      return revenueSheets(request, entityIds);
    case "folha":
      return payrollSheets(request, entityIds);
    case "assinaturas":
      return subscriptionSheets(entityIds);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------

async function cashFlowSheets(request: ReportRequest, entityIds: string[]): Promise<ExportSheet[]> {
  const { report } = await loadCashFlow({
    entityIds,
    from: request.from,
    to: monthEnd(request.to),
  });

  const header: ExportValue[] = ["Linha", ...report.periods.map(formatPeriodShort), "Total"];
  const rows: ExportValue[][] = [header];

  rows.push(["Saldo inicial", ...report.opening, report.opening[0] ?? 0n]);

  for (const section of report.sections) {
    if (section.rows.length === 0) continue;
    rows.push([section.label.toUpperCase()]);
    for (const line of section.rows) {
      rows.push([`${line.code ?? ""} ${line.label}`.trim(), ...line.values, line.total]);
    }
    rows.push([`Total de ${section.label.toLowerCase()}`, ...section.totals, section.total]);
  }

  rows.push(["Movimento líquido", ...report.net, null]);
  rows.push(["Saldo final", ...report.closing, report.closing[report.closing.length - 1] ?? 0n]);

  return [{ name: "Fluxo de caixa", rows }];
}

async function plSheets(request: ReportRequest, entityIds: string[]): Promise<ExportSheet[]> {
  const [{ report }, ledgers] = await Promise.all([
    loadPl({
      entityIds,
      entities: request.entities.map((entity) => ({ id: entity.id, name: entity.name })),
      from: request.from,
      to: request.to,
      consolidated: request.consolidated,
    }),
    compareLedgers({ entityIds, from: request.from, to: request.to }),
  ]);

  const header: ExportValue[] = [
    "Linha",
    ...report.columns.map((column) => column.label),
    ...(request.consolidated ? [] : ["Total"]),
  ];

  const rows: ExportValue[][] = [
    header,
    ...report.lines.map((line) => [
      line.kind === "category" ? `  ${line.label}` : line.label,
      ...line.values,
      ...(request.consolidated ? [] : [line.total]),
    ]),
  ];

  const comparison: ExportValue[][] = [
    ["Mês", "Receita reconhecida", "Entrou no caixa", "Custo reconhecido", "Saiu do caixa"],
    ...ledgers.rows.map((row) => [
      formatPeriodShort(row.period),
      row.recognizedRevenue,
      row.cashIn,
      row.recognizedCost,
      row.cashOut,
    ]),
  ];

  return [
    { name: "DRE", rows },
    { name: "Caixa x competência", rows: comparison },
  ];
}

async function recognitionSheets(
  request: ReportRequest,
  entityIds: string[],
): Promise<ExportSheet[]> {
  const [rows, categories, clients, contracts] = await Promise.all([
    listRecognition(entityIds, { from: request.from, to: request.to }),
    listCategories(entityIds, { includeInactive: true }),
    listClients(entityIds, { includeInactive: true }),
    listContracts(entityIds, { includeSuperseded: true }),
  ]);

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));

  return [
    {
      name: "Competência",
      rows: [
        ["Mês", "Código", "Categoria", "Tipo", "Contrato", "Cliente", "Origem", "Editada", "Valor"],
        ...rows
          .sort((a, b) => a.period.localeCompare(b.period))
          .map((row) => [
            formatPeriodShort(row.period),
            categoryById.get(row.categoryId)?.code ?? "",
            categoryById.get(row.categoryId)?.name ?? "",
            row.kind === "revenue" ? "receita" : "custo",
            row.contractId ? (contractById.get(row.contractId)?.name ?? "") : "",
            row.clientId ? (clientById.get(row.clientId)?.name ?? "") : "",
            row.source,
            row.manuallyEdited ? "sim" : "não",
            row.kind === "revenue" ? row.amount : -row.amount,
          ]),
      ],
    },
  ];
}

async function entrySheets(request: ReportRequest, entityIds: string[]): Promise<ExportSheet[]> {
  const [entries, accounts, categories, clients] = await Promise.all([
    listCashEntries({ entityIds, from: request.from, to: monthEnd(request.to), limit: 20000 }),
    listAccounts(entityIds, { includeInactive: true }),
    listCategories(entityIds, { includeInactive: true }),
    listClients(entityIds, { includeInactive: true }),
  ]);

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const clientById = new Map(clients.map((client) => [client.id, client]));

  return [
    {
      name: "Lançamentos",
      rows: [
        [
          "Data",
          "Competência",
          "Conta",
          "Descrição",
          "Contraparte",
          "CNPJ/CPF",
          "Código",
          "Categoria",
          "Cliente",
          "Valor",
        ],
        ...entries.map((entry) => [
          formatPtBRDate(entry.occurredOn),
          formatPeriodShort(entry.competencePeriod ?? `${entry.occurredOn.slice(0, 8)}01`),
          accountById.get(entry.accountId)?.name ?? "",
          entry.description,
          entry.counterpartyName ?? "",
          entry.counterpartyTaxId ?? "",
          entry.categoryId ? (categoryById.get(entry.categoryId)?.code ?? "") : "",
          entry.categoryId ? (categoryById.get(entry.categoryId)?.name ?? "") : "Sem categoria",
          entry.clientId ? (clientById.get(entry.clientId)?.name ?? "") : "",
          entry.direction === "in" ? entry.amount : -entry.amount,
        ]),
      ],
    },
  ];
}

async function revenueSheets(request: ReportRequest, entityIds: string[]): Promise<ExportSheet[]> {
  const periods = periodsOf(request.from, request.to);
  const [recognition, clients, contracts] = await Promise.all([
    listRecognition(entityIds, { from: request.from, to: request.to }),
    listClients(entityIds, { includeInactive: true }),
    listContracts(entityIds),
  ]);

  const clientById = new Map(clients.map((client) => [client.id, client]));
  const indexOf = new Map(periods.map((period, index) => [period, index]));

  const byClient = new Map<string, bigint[]>();
  for (const row of recognition) {
    if (row.kind !== "revenue") continue;
    const index = indexOf.get(row.period);
    if (index === undefined) continue;
    const key = row.clientId ?? "";
    const values = byClient.get(key) ?? periods.map(() => 0n);
    values[index] = (values[index] as bigint) + row.amount;
    byClient.set(key, values);
  }

  const backlog = await Promise.all(
    contracts
      .filter((contract) => contract.status === "active" || contract.status === "completed")
      .map(async (contract) => ({
        contract,
        deferred: deferredRevenue(contract, await listRecognitionForContract(contract.id)),
      })),
  );

  return [
    {
      name: "Receita por cliente",
      rows: [
        ["Cliente", ...periods.map(formatPeriodShort)],
        ...[...byClient].map(([clientId, values]) => [
          clientId === "" ? "Sem cliente" : (clientById.get(clientId)?.name ?? "Cliente removido"),
          ...values,
        ]),
      ],
    },
    {
      name: "Receita diferida",
      rows: [
        ["Contrato", "Cliente", "Contratado", "Reconhecido", "A reconhecer", "A faturar"],
        ...backlog.map(({ contract, deferred }) => [
          contract.name,
          clientById.get(contract.clientId)?.name ?? "",
          deferred.contracted,
          deferred.recognized,
          deferred.deferred !== null && deferred.deferred > 0n ? deferred.deferred : null,
          deferred.deferred !== null && deferred.deferred < 0n ? -deferred.deferred : null,
        ]),
      ],
    },
  ];
}

async function payrollSheets(request: ReportRequest, entityIds: string[]): Promise<ExportSheet[]> {
  const periods = periodsOf(request.from, request.to);
  const [recognition, people, clients] = await Promise.all([
    listRecognition(entityIds, { from: request.from, to: request.to }),
    listPeopleRecords(entityIds, { includeInactive: true }),
    listClients(entityIds, { includeInactive: true }),
  ]);

  const personById = new Map(people.map((person) => [person.id, person]));
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const indexOf = new Map(periods.map((period, index) => [period, index]));

  const byPerson = new Map<string, bigint[]>();
  for (const row of recognition) {
    if (row.kind !== "cost" || row.personId === null) continue;
    const index = indexOf.get(row.period);
    if (index === undefined) continue;
    const values = byPerson.get(row.personId) ?? periods.map(() => 0n);
    values[index] = (values[index] as bigint) + row.amount;
    byPerson.set(row.personId, values);
  }

  return [
    {
      name: "Folha",
      rows: [
        ["Pessoa", "Cargo", "Vínculo", "Squad", "Cliente", ...periods.map(formatPeriodShort)],
        ...[...byPerson].map(([personId, values]) => {
          const person = personById.get(personId);
          return [
            person?.name ?? "Pessoa removida",
            person?.role ?? "",
            person?.bond ?? "",
            person?.squad ?? "",
            person?.clientId ? (clientById.get(person.clientId)?.name ?? "") : "",
            ...values,
          ];
        }),
      ],
    },
  ];
}

async function subscriptionSheets(entityIds: string[]): Promise<ExportSheet[]> {
  const [entries, categories, accounts] = await Promise.all([
    listCashEntries({ entityIds, direction: "out", limit: 20000 }),
    listCategories(entityIds, { includeInactive: true }),
    listAccounts(entityIds, { includeInactive: true }),
  ]);

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const recurrences = detectRecurring(
    entries.map((entry) => ({
      id: entry.id,
      description: entry.description,
      amount: entry.amount,
      occurredOn: entry.occurredOn,
      categoryId: entry.categoryId,
      accountId: entry.accountId,
    })),
  );

  return [
    {
      name: "Assinaturas",
      rows: [
        ["Fornecedor", "Categoria", "Conta", "Cadência", "Cobranças", "Última", "Ativa", "Por mês", "Por ano"],
        ...recurrences.map((recurrence) => [
          recurrence.label,
          recurrence.categoryId ? (categoryById.get(recurrence.categoryId)?.name ?? "") : "",
          accountById.get(recurrence.accountId)?.name ?? "",
          recurrence.cadence,
          recurrence.occurrences,
          formatPtBRDate(recurrence.lastCharge),
          recurrence.active ? "sim" : "não",
          recurrence.monthlyCost,
          recurrence.annualCost,
        ]),
      ],
    },
  ];
}
