"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWriteContext } from "@/lib/actions/context";
import {
  amendContract,
  applyRecognition,
  createContract,
  getContract,
  listContracts,
  savePocReport,
  updateContract,
  type ContractInput,
} from "@/lib/data/contracts";
import {
  readBoolean,
  readChoice,
  readDate,
  readOptionalPeriod,
  readOptionalText,
  readText,
  toFormState,
  type FormState,
} from "@/lib/form";
import { parseMoney, type Cents } from "@/lib/money";
import { periodOf, todayInSaoPaulo, type Period } from "@/lib/dates";
import { isWithinRange, parsePercent } from "@/lib/recognition/percent";
import type { ContractStatus, ContractType, RecognitionMethod } from "@/lib/recognition/engine";

const TYPES: readonly ContractType[] = ["retainer", "project"];
const STATUSES: readonly ContractStatus[] = ["draft", "active", "completed", "cancelled"];
const METHODS: readonly RecognitionMethod[] = ["straight_line", "poc", "manual"];

function optionalMoney(data: FormData, name: string, label: string): Cents | null {
  const value = String(data.get(name) ?? "").trim();
  if (value === "") return null;
  try {
    return parseMoney(value);
  } catch {
    throw new Error(`${label} não é um valor válido. Use 1.234,56.`);
  }
}

function optionalDate(data: FormData, name: string, label: string) {
  const value = String(data.get(name) ?? "").trim();
  return value === "" ? null : readDate(data, name, label);
}

function readContract(data: FormData): ContractInput {
  const type = readChoice(data, "type", TYPES, "O tipo");
  const method = readChoice(data, "recognitionMethod", METHODS, "O método de reconhecimento");
  const totalValue = optionalMoney(data, "totalValue", "O valor total");
  const monthlyValue = optionalMoney(data, "monthlyValue", "O valor mensal");
  const startDate = optionalDate(data, "startDate", "A data de início");
  const endDate = optionalDate(data, "endDate", "A data de fim");

  if (startDate && endDate && endDate < startDate) {
    throw new Error("a data de fim é anterior à de início.");
  }

  // Refusing here is friendlier than letting the engine produce nothing and explain why
  // only after the contract is saved.
  if (method === "poc" && totalValue === null) {
    throw new Error("um projeto por POC precisa de valor total — é sobre ele que o percentual incide.");
  }
  if (method === "straight_line" && monthlyValue === null && totalValue === null) {
    throw new Error("informe o valor mensal ou o valor total.");
  }
  if (method === "straight_line" && monthlyValue === null && endDate === null) {
    throw new Error("com valor total e sem valor mensal, o contrato precisa de data de fim.");
  }

  return {
    clientId: readText(data, "clientId", "O cliente"),
    name: readText(data, "name", "O nome do contrato"),
    type,
    status: readChoice(data, "status", STATUSES, "A situação"),
    // Empty means "decide from the type", which is what almost every contract wants.
    categoryId: readOptionalText(data, "categoryId"),
    totalValue,
    monthlyValue,
    startDate,
    endDate,
    billingTerms: readOptionalText(data, "billingTerms"),
    paymentTerms: readOptionalText(data, "paymentTerms"),
    recognitionMethod: method,
    prorateFirstLastMonth: readBoolean(data, "prorateFirstLastMonth"),
    isIntercompany: readBoolean(data, "isIntercompany"),
  };
}

export async function saveContractAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const id = String(data.get("id") ?? "");
  const amend = String(data.get("amend") ?? "") === "true";
  let target = id;

  try {
    const { entity } = await requireWriteContext(slug);
    const input = readContract(data);

    if (amend && id) {
      const original = await getContract(id);
      if (!original) throw new Error("contrato não encontrado.");
      target = await amendContract(entity.id, original, input);
    } else if (id) {
      await updateContract(id, input);
    } else {
      target = await createContract(entity.id, input);
    }
  } catch (cause) {
    return toFormState(cause, data);
  }

  revalidatePath(`/${slug}/contratos`);
  redirect(`/${slug}/contratos/${target}`);
}

/** Records a cumulative POC figure and immediately re-runs the engine for that contract. */
export async function savePocAction(_previous: FormState, data: FormData): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const contractId = String(data.get("contractId") ?? "");

  try {
    const { entity, userId } = await requireWriteContext(slug);
    const contract = await getContract(contractId);
    if (!contract) throw new Error("contrato não encontrado.");

    const period = readOptionalPeriod(data, "period", "O mês");
    if (!period) throw new Error("informe o mês do reporte.");

    const cumulative = parsePercent(readText(data, "cumulative", "O percentual"));
    if (!isWithinRange(cumulative)) throw new Error("o percentual tem que estar entre 0 e 100.");

    const isCorrection = readBoolean(data, "isCorrection");
    await savePocReport(entity.id, contractId, period, cumulative, isCorrection, userId);

    const result = await applyRecognition(contract, throughPeriod(period), userId);

    revalidatePath(`/${slug}/contratos/${contractId}`);
    revalidatePath(`/${slug}/dre`);

    return { notices: [describe(result)] };
  } catch (cause) {
    return toFormState(cause, data);
  }
}

/** Re-runs the engine for one contract, or for every active contract of the entity. */
export async function runRecognitionAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const contractId = String(data.get("contractId") ?? "");

  try {
    const { entity, userId } = await requireWriteContext(slug);
    const through = readOptionalPeriod(data, "through", "O mês") ?? periodOf(todayInSaoPaulo());

    const contracts = contractId
      ? [await getContract(contractId)].filter((contract) => contract !== null)
      : await listContracts([entity.id]);

    if (contracts.length === 0) return { notices: ["nenhum contrato para reconhecer."] };

    const notices: string[] = [];
    let written = 0;
    let skipped = 0;
    let removed = 0;
    const missing: string[] = [];

    for (const contract of contracts) {
      const result = await applyRecognition(contract, through, userId);
      written += result.written;
      skipped += result.skipped;
      removed += result.removed;
      for (const period of result.missingReports) missing.push(`${contract.name} · ${period}`);
      for (const warning of result.warnings) notices.push(`${contract.name}: ${warning}`);
    }

    revalidatePath(`/${slug}/contratos`);
    if (contractId) revalidatePath(`/${slug}/contratos/${contractId}`);
    revalidatePath(`/${slug}/dre`);

    notices.unshift(
      `${written} linha${written === 1 ? "" : "s"} de competência gravada${written === 1 ? "" : "s"}` +
        (skipped > 0 ? `, ${skipped} preservada${skipped === 1 ? "" : "s"} por edição manual` : "") +
        (removed > 0 ? `, ${removed} removida${removed === 1 ? "" : "s"}` : "") +
        ".",
    );
    if (missing.length > 0) {
      notices.push(
        `sem reporte de POC: ${missing.slice(0, 8).join(", ")}` +
          (missing.length > 8 ? ` e mais ${missing.length - 8}` : ""),
      );
    }

    return { notices };
  } catch (cause) {
    return toFormState(cause, data);
  }
}

function throughPeriod(period: Period): Period {
  const current = periodOf(todayInSaoPaulo());
  return period > current ? period : current;
}

function describe(result: {
  written: number;
  skipped: number;
  missingReports: string[];
  warnings: string[];
}): string {
  return (
    `reporte gravado; ${result.written} linha${result.written === 1 ? "" : "s"} de competência` +
    ` recalculada${result.written === 1 ? "" : "s"}` +
    (result.skipped > 0 ? `, ${result.skipped} preservada${result.skipped === 1 ? "" : "s"}` : "") +
    "."
  );
}
