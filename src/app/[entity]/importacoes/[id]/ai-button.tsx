"use client";

import { useActionState } from "react";
import { suggestWithAiAction } from "../actions";
import { Button } from "@/components/ui/button";
import { FormError, FormNotice } from "@/components/ui/field";
import { EMPTY_FORM_STATE } from "@/lib/form";

export function AiSuggestButton({
  slug,
  importId,
  undecided,
  configured,
}: {
  slug: string;
  importId: string;
  undecided: number;
  configured: boolean;
}) {
  const [state, action, pending] = useActionState(suggestWithAiAction, EMPTY_FORM_STATE);

  if (!configured) {
    return (
      <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
        A sugestão por IA está desligada porque não há <code className="font-mono">ANTHROPIC_API_KEY</code>{" "}
        configurada. Todo o resto funciona sem ela — a IA só reduz digitação.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="importId" value={importId} />

      <FormError>{state.error}</FormError>
      {state.notices?.map((notice) => <FormNotice key={notice}>{notice}</FormNotice>)}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" size="sm" disabled={pending || undecided === 0}>
          {pending ? "Perguntando à IA…" : `Sugerir categoria para ${undecided} linha${undecided === 1 ? "" : "s"}`}
        </Button>
        <span className="text-xs text-muted">
          Só o que as regras e o histórico não decidiram. A IA classifica texto — ela não vê
          valor, e não aprova nada.
        </span>
      </div>
    </form>
  );
}
