"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createCashEntry,
  deleteCashEntry,
  updateCashEntry,
  type CashEntryInput,
} from "@/lib/data/cash-entries";
import { listCategories } from "@/lib/data/categories";
import { requireWriteContext } from "@/lib/actions/context";
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
import type { EntryDirection } from "@/lib/ledger-types";

const DIRECTIONS: readonly EntryDirection[] = ["in", "out"];

function readEntry(data: FormData): CashEntryInput {
  const amount = readMoney(data, "amount", "O valor");
  if (amount < 0n) {
    // The sign lives in `direction`, and the CHECK in 0001 enforces it. Catching it here
    // means the user gets a sentence instead of a constraint name.
    throw new Error("o valor não pode ser negativo — use entrada ou saída.");
  }

  return {
    accountId: readText(data, "accountId", "A conta"),
    occurredOn: readDate(data, "occurredOn", "A data"),
    competencePeriod: readOptionalPeriod(data, "competencePeriod", "A competência"),
    amount,
    direction: readChoice(data, "direction", DIRECTIONS, "O sentido"),
    description: readText(data, "description", "A descrição"),
    categoryId: readOptionalId(data, "categoryId"),
    clientId: readOptionalId(data, "clientId"),
    personId: readOptionalId(data, "personId"),
    vendor: readOptionalText(data, "vendor"),
    isIntercompany: readBoolean(data, "isIntercompany"),
    counterpartAccountId: readOptionalId(data, "counterpartAccountId"),
    allowDuplicate: readBoolean(data, "allowDuplicate"),
  };
}

export async function saveCashEntryAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const id = String(data.get("id") ?? "");
  let notices: string[] = [];

  try {
    const { entity, userId } = await requireWriteContext(slug);
    const input = readEntry(data);
    const categories = await listCategories([entity.id], { includeInactive: true });

    const result = id
      ? await updateCashEntry(entity.id, id, input, categories, userId)
      : await createCashEntry(entity.id, input, categories, userId);

    notices = result.notices;
  } catch (cause) {
    return toFormState(cause, data);
  }

  revalidatePath(`/${slug}/lancamentos`);
  revalidatePath(`/${slug}/fluxo-de-caixa`);

  // A notice means the save worked but did something worth reading — stay on the form so
  // it is actually read, instead of flashing past on a redirect.
  if (notices.length > 0) return { notices };
  redirect(`/${slug}/lancamentos`);
}

export async function deleteCashEntryAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const id = String(data.get("id") ?? "");

  try {
    await requireWriteContext(slug);
    if (!id) return { error: "lançamento não informado." };
    await deleteCashEntry(id);
  } catch (cause) {
    return toFormState(cause, data);
  }

  revalidatePath(`/${slug}/lancamentos`);
  revalidatePath(`/${slug}/fluxo-de-caixa`);
  redirect(`/${slug}/lancamentos`);
}
