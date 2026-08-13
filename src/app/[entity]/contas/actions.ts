"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAccount, updateAccount, type AccountInput } from "@/lib/data/accounts";
import { requireWriteContext } from "@/lib/actions/context";
import {
  readBoolean,
  readChoice,
  readDate,
  readOptionalMoney,
  readOptionalText,
  readText,
  toFormState,
  type FormState,
} from "@/lib/form";
import type { AccountType } from "@/lib/ledger-types";

const TYPES: readonly AccountType[] = ["bank", "credit_card", "cash", "investment"];

function readAccount(data: FormData): AccountInput {
  return {
    name: readText(data, "name", "O nome da conta"),
    type: readChoice(data, "type", TYPES, "O tipo"),
    institution: readOptionalText(data, "institution"),
    branch: readOptionalText(data, "branch"),
    number: readOptionalText(data, "number"),
    lastDigits: readOptionalText(data, "lastDigits"),
    openingBalance: readOptionalMoney(data, "openingBalance", "O saldo de abertura"),
    openingDate: readDate(data, "openingDate", "A data do saldo de abertura"),
    active: readBoolean(data, "active"),
  };
}

export async function saveAccountAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const id = String(data.get("id") ?? "");

  try {
    const { entity } = await requireWriteContext(slug);
    const input = readAccount(data);

    if (id) await updateAccount(id, input);
    else await createAccount(entity.id, input);
  } catch (cause) {
    return toFormState(cause, data);
  }

  revalidatePath(`/${slug}/contas`);
  revalidatePath(`/${slug}/fluxo-de-caixa`);
  redirect(`/${slug}/contas`);
}
