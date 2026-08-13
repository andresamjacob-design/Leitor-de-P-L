"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createCategory,
  deactivateCategory,
  updateCategory,
  type CategoryInput,
} from "@/lib/data/categories";
import { requireWriteContext } from "@/lib/actions/context";
import {
  echo,
  readBoolean,
  readChoice,
  readInteger,
  readOptionalId,
  readOptionalText,
  readText,
  toFormState,
  type FormState,
} from "@/lib/form";
import type { CategoryKind } from "@/lib/ledger-types";

const KINDS: readonly CategoryKind[] = [
  "revenue",
  "cost",
  "expense",
  "tax",
  "transfer",
  "owner_draw",
];

function readCategory(data: FormData): CategoryInput {
  return {
    code: readText(data, "code", "O código"),
    name: readText(data, "name", "O nome"),
    kind: readChoice(data, "kind", KINDS, "A natureza"),
    parentId: readOptionalId(data, "parentId"),
    dreGroup: readOptionalText(data, "dreGroup"),
    sortOrder: readInteger(data, "sortOrder", 999),
    active: readBoolean(data, "active"),
  };
}

export async function saveCategoryAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const id = String(data.get("id") ?? "");

  try {
    const { entity } = await requireWriteContext(slug);
    const input = readCategory(data);

    if (id === input.parentId && id !== "") {
      return { error: "uma categoria não pode ser filha dela mesma.", values: echo(data) };
    }

    if (id) await updateCategory(id, input);
    else await createCategory(entity.id, input);
  } catch (cause) {
    return toFormState(cause, data);
  }

  revalidatePath(`/${slug}/plano-de-contas`);
  revalidatePath(`/${slug}/fluxo-de-caixa`);
  redirect(`/${slug}/plano-de-contas`);
}

/**
 * Categories are deactivated, never deleted. A deleted one would strip the classification
 * off every entry that used it and change history retroactively — the `restrict` foreign
 * key on `cash_entries.category_id` refuses it anyway.
 */
export async function deactivateCategoryAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const id = String(data.get("id") ?? "");

  try {
    await requireWriteContext(slug);
    if (!id) return { error: "categoria não informada." };
    await deactivateCategory(id);
  } catch (cause) {
    return toFormState(cause, data);
  }

  revalidatePath(`/${slug}/plano-de-contas`);
  redirect(`/${slug}/plano-de-contas`);
}
