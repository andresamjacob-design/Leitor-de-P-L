/**
 * The revenue recognition engine (SPEC §9).
 *
 * Pure: a contract and its POC reports go in, the rows that belong in
 * `recognition_entries` come out. Nothing here reads or writes a database, so the rules
 * that decide when revenue is earned can be argued with in a test.
 *
 * This is the half of the system that makes the second ledger worth having. Cash tells
 * you when the money arrived; this tells you when it was earned, and the gap between them
 * is the deferred revenue report — the number that catches a mistake in either one.
 *
 * Three properties it has to keep:
 *
 *   **Idempotent.** Re-running for the same period produces the same rows. The caller
 *   upserts on `(contract, period, source, kind)`, so a second run changes nothing.
 *   **Never retroactive.** A correction lands in the month it was noticed, not by editing
 *   a month that was already reported (SPEC §9, test 2).
 *   **Every cent lands.** Spreading a total across months uses largest-remainder
 *   allocation, so the parts add back to exactly the total.
 */

import { allocate, mulRatio, sum, type Cents } from "@/lib/money";
import {
  addMonths,
  compareDates,
  coveredDays,
  eachPeriod,
  periodOf,
  type IsoDate,
  type Period,
} from "@/lib/dates";
import { FULL, type Percent } from "@/lib/recognition/percent";

export type ContractType = "retainer" | "project";
export type ContractStatus = "draft" | "active" | "completed" | "cancelled";
export type RecognitionMethod = "straight_line" | "poc" | "manual";

export type RecognitionContract = {
  id: string;
  clientId: string;
  /** Where the revenue lands in the chart of accounts. */
  categoryId: string;
  type: ContractType;
  status: ContractStatus;
  totalValue: Cents | null;
  monthlyValue: Cents | null;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  recognitionMethod: RecognitionMethod;
  /** Partial first and last months by days, or billed whole (D14f). */
  prorateFirstLastMonth: boolean;
  isIntercompany: boolean;
};

export type PocReport = {
  period: Period;
  /** Cumulative, in millipercent. The engine stores this and computes the delta. */
  cumulative: Percent;
  isCorrection: boolean;
};

export type PlannedRow = {
  contractId: string;
  clientId: string;
  categoryId: string;
  period: Period;
  kind: "revenue";
  amount: Cents;
  method: RecognitionMethod;
  isIntercompany: boolean;
  /** How the number was arrived at, in Portuguese, for the screen. */
  basis: string;
};

export type RecognitionPlan = {
  rows: PlannedRow[];
  /** Months inside the term with no POC report — zero revenue, and worth chasing. */
  missingReports: Period[];
  warnings: string[];
};

const EMPTY: RecognitionPlan = { rows: [], missingReports: [], warnings: [] };

/**
 * The months a contract covers, up to `through`.
 *
 * An open-ended retainer runs while it is active, which is why `through` exists: without
 * an end date, "every month" has no end, and the caller decides how far to look.
 */
export function contractPeriods(
  contract: RecognitionContract,
  through: Period,
): Period[] {
  if (!contract.startDate) return [];
  const last =
    contract.endDate && compareDates(contract.endDate, through) < 0
      ? contract.endDate
      : through;
  if (compareDates(contract.startDate, last) > 0) return [];
  return eachPeriod(contract.startDate, last);
}

/** The days of a period the contract actually covers, as a weight for allocation. */
function coverage(contract: RecognitionContract, period: Period): { covered: number; total: number } {
  if (!contract.startDate) return { covered: 0, total: 1 };
  return coveredDays(period, contract.startDate, contract.endDate);
}

// ---------------------------------------------------------------------------
// Straight line
// ---------------------------------------------------------------------------

function planStraightLine(
  contract: RecognitionContract,
  periods: readonly Period[],
): RecognitionPlan {
  const warnings: string[] = [];

  // A stated monthly value is the contract's own words; a total spread over a term is
  // arithmetic. When both exist the stated value wins, and the difference is reported
  // rather than silently reconciled.
  if (contract.monthlyValue !== null) {
    const rows = periods.map((period) => {
      const { covered, total } = coverage(contract, period);
      const partial = contract.prorateFirstLastMonth && covered < total;
      const amount = partial
        ? mulRatio(contract.monthlyValue as Cents, BigInt(covered), BigInt(total))
        : (contract.monthlyValue as Cents);

      return {
        contractId: contract.id,
        clientId: contract.clientId,
        categoryId: contract.categoryId,
        period,
        kind: "revenue" as const,
        amount,
        method: "straight_line" as const,
        isIntercompany: contract.isIntercompany,
        basis: partial ? `${covered}/${total} dias do mês` : "mensalidade cheia",
      };
    });

    if (contract.totalValue !== null && contract.endDate) {
      const planned = sum(rows.map((row) => row.amount));
      if (planned !== contract.totalValue) {
        warnings.push(
          `a mensalidade vezes o prazo dá ${planned} centavos, e o contrato declara ` +
            `${contract.totalValue}. Vale a mensalidade; confira o valor total.`,
        );
      }
    }

    return { rows, missingReports: [], warnings };
  }

  if (contract.totalValue === null) {
    return {
      ...EMPTY,
      warnings: ["o contrato não tem valor mensal nem valor total — nada a reconhecer."],
    };
  }
  if (!contract.endDate) {
    return {
      ...EMPTY,
      warnings: [
        "um contrato com valor total precisa de data de fim para o valor ser distribuído. " +
          "Informe a data de fim ou um valor mensal.",
      ],
    };
  }

  // Largest-remainder over the days each month covers: the parts add back to exactly the
  // total, and the partial months carry their real weight.
  // Prorating weighs each month by the days it covers. "Full month" weighs every covered
  // month the same — weighing by month length instead would make January worth more than
  // February for no reason anyone contracted for.
  const weights = periods.map((period) => {
    const { covered } = coverage(contract, period);
    if (covered === 0) return 0n;
    return contract.prorateFirstLastMonth ? BigInt(covered) : 1n;
  });

  if (weights.every((weight) => weight === 0n)) {
    return { ...EMPTY, warnings: ["o prazo do contrato não cobre nenhum dia."] };
  }

  const parts = allocate(contract.totalValue, weights);

  return {
    rows: periods.map((period, index) => ({
      contractId: contract.id,
      clientId: contract.clientId,
      categoryId: contract.categoryId,
      period,
      kind: "revenue" as const,
      amount: parts[index] as Cents,
      method: "straight_line" as const,
      isIntercompany: contract.isIntercompany,
      basis: `parcela ${index + 1} de ${periods.length}`,
    })),
    missingReports: [],
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Percent of completion
// ---------------------------------------------------------------------------

function planPoc(
  contract: RecognitionContract,
  periods: readonly Period[],
  reports: readonly PocReport[],
): RecognitionPlan {
  const warnings: string[] = [];

  if (contract.totalValue === null) {
    return { ...EMPTY, warnings: ["um projeto por POC precisa de valor total."] };
  }

  const byPeriod = new Map(reports.map((report) => [report.period, report]));
  const ordered = [...reports].sort((a, b) => a.period.localeCompare(b.period));

  const rows: PlannedRow[] = [];
  const missingReports: Period[] = [];
  let previous: Percent = 0n;

  for (const report of ordered) {
    if (report.cumulative < 0n || report.cumulative > FULL) {
      warnings.push(`o percentual de ${report.period} está fora de 0 a 100.`);
      continue;
    }
    if (report.cumulative < previous && !report.isCorrection) {
      warnings.push(
        `${report.period} reporta menos que o mês anterior sem estar marcado como ` +
          "correção. A linha foi gerada mesmo assim, mas confira.",
      );
    }

    const delta = report.cumulative - previous;
    previous = report.cumulative;
    if (delta === 0n) continue;

    rows.push({
      contractId: contract.id,
      clientId: contract.clientId,
      categoryId: contract.categoryId,
      period: report.period,
      kind: "revenue",
      // The delta, never the cumulative: this is what makes a wrong month self-correct
      // in the next one instead of compounding (SPEC §9).
      amount: mulRatio(contract.totalValue, delta, FULL),
      method: "poc",
      isIntercompany: contract.isIntercompany,
      basis: delta < 0n ? "correção de POC" : "avanço de POC no mês",
    });
  }

  // A month inside the term with nobody reporting is zero revenue — and a question.
  for (const period of periods) {
    if (!byPeriod.has(period)) missingReports.push(period);
  }

  // Closing the project recognises whatever is left, in the month it closed.
  if (contract.status === "completed" && previous < FULL) {
    const remainder = contract.totalValue - sum(rows.map((row) => row.amount));
    if (remainder !== 0n) {
      const closing =
        (contract.endDate ? periodOf(contract.endDate) : undefined) ??
        periods[periods.length - 1] ??
        (ordered[ordered.length - 1]?.period as Period | undefined);

      if (closing) {
        rows.push({
          contractId: contract.id,
          clientId: contract.clientId,
          categoryId: contract.categoryId,
          period: closing,
          kind: "revenue",
          amount: remainder,
          method: "poc",
          isIntercompany: contract.isIntercompany,
          basis: "encerramento do projeto: reconhece o saldo",
        });
      }
    }
  }

  return { rows, missingReports, warnings };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function planContract(
  contract: RecognitionContract,
  {
    through,
    pocReports = [],
  }: { through: Period; pocReports?: readonly PocReport[] },
): RecognitionPlan {
  if (contract.status === "draft") {
    return { ...EMPTY, warnings: ["contrato em rascunho: nada é reconhecido até ser confirmado."] };
  }
  if (contract.status === "cancelled") {
    return { ...EMPTY, warnings: ["contrato cancelado."] };
  }
  if (!contract.startDate) {
    return { ...EMPTY, warnings: ["o contrato não tem data de início."] };
  }
  if (contract.recognitionMethod === "manual") {
    return {
      ...EMPTY,
      warnings: ["reconhecimento manual: as linhas são lançadas à mão, o motor não gera nada."],
    };
  }

  const periods = contractPeriods(contract, through);
  if (periods.length === 0) {
    return { ...EMPTY, warnings: ["o contrato ainda não começou no período consultado."] };
  }

  return contract.recognitionMethod === "poc"
    ? planPoc(contract, periods, pocReports)
    : planStraightLine(contract, periods);
}

// ---------------------------------------------------------------------------
// Deferred revenue
// ---------------------------------------------------------------------------

export type DeferredRevenue = {
  contractId: string;
  contracted: Cents | null;
  recognized: Cents;
  /** Contracted minus recognised. Negative means more was recognised than contracted. */
  deferred: Cents | null;
};

/**
 * What is contracted but not yet earned.
 *
 * This is the bridge between the two ledgers and the number that denounces a mistake in
 * either: if it drifts from what the contracts say, the engine or the data is wrong.
 * An open-ended retainer has no contracted total, so it has no deferred balance — saying
 * "unknown" is right, and inventing one would be worse.
 */
export function deferredRevenue(
  contract: RecognitionContract,
  recognizedRows: readonly { amount: Cents }[],
): DeferredRevenue {
  const recognized = sum(recognizedRows.map((row) => row.amount));
  const contracted =
    contract.totalValue ??
    (contract.monthlyValue !== null && contract.startDate && contract.endDate
      ? sum(
          eachPeriod(contract.startDate, contract.endDate).map((period) => {
            const { covered, total } = coveredDays(period, contract.startDate as IsoDate, contract.endDate);
            return contract.prorateFirstLastMonth && covered < total
              ? mulRatio(contract.monthlyValue as Cents, BigInt(covered), BigInt(total))
              : (contract.monthlyValue as Cents);
          }),
        )
      : null);

  return {
    contractId: contract.id,
    contracted,
    recognized,
    deferred: contracted === null ? null : contracted - recognized,
  };
}

/** The month after the last one a contract covers — where "through" usually wants to sit. */
export function nextPeriod(period: Period): Period {
  return addMonths(period, 1);
}
