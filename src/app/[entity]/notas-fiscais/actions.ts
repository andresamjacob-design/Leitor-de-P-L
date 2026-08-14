"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWriteContext } from "@/lib/actions/context";
import { createInvoice, updateInvoice, type InvoiceInput, type InvoiceStatus } from "@/lib/data/invoices";
import {
  readBoolean,
  readChoice,
  readDate,
  readMoney,
  readOptionalId,
  readOptionalPeriod,
  readOptionalText,
  readText,
  toFormState,
  type FormState,
} from "@/lib/form";
import { parseMoney, type Cents } from "@/lib/money";

const STATUSES: readonly InvoiceStatus[] = ["issued", "partially_paid", "paid", "cancelled"];

function optionalMoney(data: FormData, name: string, label: string): Cents | null {
  const value = String(data.get(name) ?? "").trim();
  if (value === "") return null;
  try {
    return parseMoney(value);
  } catch {
    throw new Error(`${label} não é um valor válido. Use 1.234,56.`);
  }
}

function readInvoiceInput(data: FormData): InvoiceInput {
  const servicePeriod = readOptionalPeriod(data, "servicePeriod", "A competência");
  if (!servicePeriod) {
    throw new Error("informe a competência — é ela que define o mês, não a data de emissão.");
  }

  const grossAmount = readMoney(data, "grossAmount", "O valor bruto");
  const netAmount = optionalMoney(data, "netAmount", "O valor líquido");
  if (netAmount !== null && netAmount > grossAmount) {
    throw new Error("o valor líquido é maior que o bruto.");
  }

  const dueDateRaw = String(data.get("dueDate") ?? "").trim();

  return {
    clientId: readText(data, "clientId", "O cliente"),
    contractId: readOptionalId(data, "contractId"),
    number: readText(data, "number", "O número da NF"),
    series: readOptionalText(data, "series"),
    issueDate: readDate(data, "issueDate", "A data de emissão"),
    servicePeriod,
    dueDate: dueDateRaw === "" ? null : readDate(data, "dueDate", "O vencimento"),
    status: readChoice(data, "status", STATUSES, "A situação"),
    grossAmount,
    netAmount,
    isIntercompany: readBoolean(data, "isIntercompany"),
    notes: readOptionalText(data, "notes"),
  };
}

export async function saveInvoiceAction(_previous: FormState, data: FormData): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const id = String(data.get("id") ?? "");

  try {
    const { entity } = await requireWriteContext(slug);
    const input = readInvoiceInput(data);
    if (id) await updateInvoice(id, input);
    else await createInvoice(entity.id, input);
  } catch (cause) {
    return toFormState(cause, data);
  }

  revalidatePath(`/${slug}/notas-fiscais`);
  redirect(`/${slug}/notas-fiscais`);
}
