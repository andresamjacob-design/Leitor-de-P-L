/**
 * Running the AI layer against the database.
 *
 * Layer 3 only (SPEC §8): it is asked about the staged lines that the deterministic
 * layers left undecided, never about the ones a rule or the history already answered.
 * Paying a model to re-derive what a rule already knows would be waste, and letting it
 * override a rule would be worse.
 *
 * What it writes: `staged_transactions.suggested_*`, and nothing else. The ledger is
 * reached only when a human approves the import, through the same path a typed entry
 * takes.
 */

import { createClient } from "@/lib/supabase/server";
import { getAiProvider, AiUnavailableError } from "@/lib/ai/provider";
import {
  buildCategorizationPrompt,
  parseCategorization,
  RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  type AiCatalogue,
  type AiSubject,
} from "@/lib/ai/categorize";
import { listCategories } from "@/lib/data/categories";
import { listClients } from "@/lib/data/clients";
import { listPeople } from "@/lib/data/rules";
import { listStaged } from "@/lib/data/imports";

/** One call per batch; a year of card invoices is a few hundred lines. */
const BATCH_SIZE = 120;

export type AiRunResult = {
  considered: number;
  suggested: number;
  discarded: { ref: string | null; reason: string }[];
  /**
   * Quantas linhas foram perguntadas e a IA não respondeu (D127). Separado de `discarded`
   * de propósito: não houve recusa nossa, houve silêncio dela. Sem este número a tela
   * mostraria N sugestões e nada sobre as linhas que ninguém olhou.
   */
  unanswered: number;
  model: string;
  warnings: string[];
};

export async function suggestWithAi(
  entityId: string,
  importId: string,
): Promise<AiRunResult> {
  const provider = getAiProvider();
  if (!provider) {
    throw new AiUnavailableError(
      "a IA não está configurada. Defina ANTHROPIC_API_KEY em .env.local — " +
        "o resto do sistema funciona sem ela.",
    );
  }

  const staged = await listStaged(importId);

  // Only what the deterministic layers could not decide.
  const undecided = staged.filter(
    (row) => row.status === "pending" && row.suggestedCategoryId === null,
  );

  if (undecided.length === 0) {
    return {
      considered: 0,
      suggested: 0,
      discarded: [],
      unanswered: 0,
      model: provider.model,
      warnings: ["não sobrou nenhuma linha sem sugestão — a IA não foi chamada."],
    };
  }

  const [categories, clients, people] = await Promise.all([
    listCategories([entityId]),
    listClients([entityId]),
    listPeople([entityId]),
  ]);

  const catalogue: AiCatalogue = {
    categories: categories.map((category) => ({
      id: category.id,
      code: category.code,
      name: category.name,
      kind: category.kind,
    })),
    clients: clients.map((client) => ({ id: client.id, name: client.name })),
    people,
  };

  const supabase = await createClient();
  const result: AiRunResult = {
    considered: undecided.length,
    suggested: 0,
    discarded: [],
    unanswered: 0,
    model: provider.model,
    warnings: [],
  };

  for (let start = 0; start < undecided.length; start += BATCH_SIZE) {
    const batch = undecided.slice(start, start + BATCH_SIZE);
    const subjects: AiSubject[] = batch.map((row) => ({
      ref: row.id,
      description: row.description,
      counterpartyName: row.counterpartyName,
      direction: row.direction,
    }));

    let text: string;
    try {
      const response = await provider.complete({
        system: SYSTEM_PROMPT,
        prompt: buildCategorizationPrompt(subjects, catalogue),
        maxTokens: 8000,
        responseSchema: RESPONSE_SCHEMA,
      });
      text = response.text;
    } catch (cause) {
      result.warnings.push(
        cause instanceof Error ? cause.message : "a chamada de IA falhou.",
      );
      // O lote inteiro ficou sem resposta — as linhas dele foram consideradas e ninguém
      // olhou para elas. Sem isto, um lote que falhou some da contagem.
      result.unanswered += batch.length;
      continue;
    }

    const { suggestions, discarded, unanswered } = parseCategorization(text, subjects, catalogue);
    result.discarded.push(...discarded);
    result.unanswered += unanswered.length;

    for (const suggestion of suggestions) {
      const { error } = await supabase
        .from("staged_transactions")
        .update({
          suggested_category_id: suggestion.categoryId,
          suggested_client_id: suggestion.clientId,
          suggested_person_id: suggestion.personId,
          suggestion_source: "ai",
          confidence: suggestion.confidence.toFixed(3),
        })
        // Belt and braces: the row must still be pending and still belong to this import.
        .eq("id", suggestion.ref)
        .eq("import_id", importId)
        .eq("status", "pending");

      if (error) {
        result.discarded.push({ ref: suggestion.ref, reason: error.message });
        continue;
      }
      result.suggested += 1;
    }
  }

  return result;
}
