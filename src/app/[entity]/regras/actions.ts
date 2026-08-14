"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWriteContext } from "@/lib/actions/context";
import { createRule, deleteRule, updateRule, type RuleInput } from "@/lib/data/rules";
import { categorizeUncategorized } from "@/lib/data/categorize";
import {
  readBoolean,
  readChoice,
  readInteger,
  readOptionalId,
  readOptionalText,
  readText,
  toFormState,
  type FormState,
} from "@/lib/form";
import { parseMoney, type Cents } from "@/lib/money";
import type { MatchType } from "@/lib/categorize/types";

const MATCH_TYPES: readonly MatchType[] = ["contains", "regex", "exact", "amount_range"];

function optionalMoney(data: FormData, name: string, label: string): Cents | null {
  const value = String(data.get(name) ?? "").trim();
  if (value === "") return null;
  try {
    return parseMoney(value);
  } catch {
    throw new Error(`${label} não é um valor válido. Use 1.234,56.`);
  }
}

function readRule(data: FormData): RuleInput {
  const matchType = readChoice(data, "matchType", MATCH_TYPES, "O tipo de comparação");
  const taxId = readOptionalText(data, "counterpartyTaxId");
  const rawPattern = String(data.get("pattern") ?? "").trim();

  // A CNPJ rule needs no text; `*` is how "this counterparty, whatever it says" is stored.
  const pattern = rawPattern === "" ? (taxId ? "*" : "") : rawPattern;
  if (pattern === "" && matchType !== "amount_range") {
    throw new Error("informe um padrão de texto ou um CNPJ.");
  }

  const amountMin = optionalMoney(data, "amountMin", "O valor mínimo");
  const amountMax = optionalMoney(data, "amountMax", "O valor máximo");
  if (matchType === "amount_range" && amountMin === null && amountMax === null) {
    throw new Error("uma regra por faixa de valor precisa de um mínimo ou de um máximo.");
  }
  if (amountMin !== null && amountMax !== null && amountMin > amountMax) {
    throw new Error("o valor mínimo é maior que o máximo.");
  }

  return {
    priority: readInteger(data, "priority", 100),
    matchType,
    pattern: pattern === "" ? "*" : pattern,
    counterpartyTaxId: taxId,
    amountMin,
    amountMax,
    accountId: readOptionalId(data, "accountId"),
    categoryId: readText(data, "categoryId", "A categoria"),
    clientId: readOptionalId(data, "clientId"),
    personId: readOptionalId(data, "personId"),
    active: readBoolean(data, "active"),
  };
}

export async function saveRuleAction(_previous: FormState, data: FormData): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const id = String(data.get("id") ?? "");

  try {
    const { entity } = await requireWriteContext(slug);
    const input = readRule(data);
    if (id) await updateRule(id, input);
    else await createRule(entity.id, input);
  } catch (cause) {
    return toFormState(cause, data);
  }

  revalidatePath(`/${slug}/regras`);
  redirect(`/${slug}/regras`);
}

export async function deleteRuleAction(_previous: FormState, data: FormData): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");
  const id = String(data.get("id") ?? "");

  try {
    await requireWriteContext(slug);
    if (!id) return { error: "regra não informada." };
    await deleteRule(id);
  } catch (cause) {
    return toFormState(cause, data);
  }

  revalidatePath(`/${slug}/regras`);
  redirect(`/${slug}/regras`);
}

const SOURCE_LABEL: Record<string, string> = {
  rule_tax_id: "regra por CNPJ",
  rule_text: "regra por texto",
  history_tax_id: "mesmo CNPJ já visto",
  history_description: "mesma descrição já vista",
  person: "nome de pessoa",
};

/**
 * Applies the engine to everything still uncategorised. Only rows with no category are
 * touched, and only above the confidence bar — a sweep that overwrote human decisions
 * would be the fastest way to make nobody trust the numbers again.
 */
export async function runEngineAction(_previous: FormState, data: FormData): Promise<FormState> {
  const slug = String(data.get("slug") ?? "");

  try {
    const { entity, userId } = await requireWriteContext(slug);
    const result = await categorizeUncategorized(entity.id, userId);

    revalidatePath(`/${slug}/lancamentos`);
    revalidatePath(`/${slug}/fluxo-de-caixa`);
    revalidatePath(`/${slug}/regras`);

    if (result.considered === 0) {
      return { notices: ["não havia lançamento sem categoria."] };
    }

    const breakdown = Object.entries(result.bySource)
      .map(([source, count]) => `${count} por ${SOURCE_LABEL[source] ?? source}`)
      .join(", ");

    return {
      notices: [
        `${result.categorized} de ${result.considered} lançamentos categorizados` +
          (breakdown ? ` (${breakdown})` : "") +
          `. ${result.undecided} continuam sem categoria.`,
      ],
    };
  } catch (cause) {
    return toFormState(cause, data);
  }
}
