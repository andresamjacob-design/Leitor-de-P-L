"use client";

import Link from "next/link";
import { useActionState } from "react";
import { extractContractAction, type ExtractState } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormNotice, Input } from "@/components/ui/field";
import { FIELD_LABEL, type ContractFieldName } from "@/lib/ai/contract";

const EMPTY: ExtractState = {};

/**
 * Upload, then the draft next to the passages it came from (SPEC §9).
 *
 * Nothing is saved by this screen. The "usar este rascunho" link carries the values into
 * the ordinary contract form, which validates every one of them — that is the whole point
 * of not letting an extraction become a contract on its own.
 */
export function ExtractForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(extractContractAction, EMPTY);
  const draft = state.draft;

  const query = new URLSearchParams();
  if (draft) {
    for (const [field, content] of Object.entries(draft.fields)) {
      query.set(field, content.value);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form action={action} className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <input type="hidden" name="slug" value={slug} />
        <FormError>{state.error}</FormError>

        <Field
          label="Contrato"
          htmlFor="file"
          hint="PDF, DOCX ou texto. PDF escaneado não dá — não tem texto para ler."
        >
          <Input id="file" name="file" type="file" accept=".pdf,.docx,.txt,.md" required className="py-1.5" />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Lendo o contrato…" : "Extrair rascunho"}
          </Button>
          <span className="text-xs text-muted">
            Nada é salvo agora. A IA propõe, você confere campo a campo.
          </span>
        </div>
      </form>

      {draft ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium">
            Rascunho de {state.filename}
          </h2>

          {draft.warnings.map((warning) => (
            <FormNotice key={warning}>{warning}</FormNotice>
          ))}

          {Object.keys(draft.fields).length === 0 ? (
            <p className="text-sm text-muted">
              Nenhum campo foi encontrado. Cadastre o contrato à mão.
            </p>
          ) : (
            <>
              <dl className="flex flex-col gap-4">
                {(Object.entries(draft.fields) as [ContractFieldName, { value: string; snippet: string | null }][]).map(
                  ([field, content]) => (
                    <div key={field} className="rounded-md border border-border p-3">
                      <dt className="text-xs text-muted">{FIELD_LABEL[field]}</dt>
                      <dd className="mt-0.5 text-sm font-medium">{content.value}</dd>
                      {content.snippet ? (
                        <p className="mt-2 border-l-2 border-border pl-3 text-xs italic text-muted">
                          “{content.snippet}”
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                          Sem trecho de origem — confira no contrato.
                        </p>
                      )}
                    </div>
                  ),
                )}
              </dl>

              {draft.missing.length > 0 ? (
                <p className="text-xs text-muted">
                  Não encontrado no documento:{" "}
                  {draft.missing.map((field) => FIELD_LABEL[field]).join(", ")}. Você preenche
                  no formulário.
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={`/${slug}/contratos/novo?${query.toString()}`}
                  className="text-sm text-accent hover:underline"
                >
                  Usar este rascunho no formulário de contrato
                </Link>
                <span className="text-xs text-muted">
                  O contrato nasce como rascunho e não reconhece nada até você confirmar.
                </span>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
