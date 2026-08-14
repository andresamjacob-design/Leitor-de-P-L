"use client";

import { useActionState } from "react";
import { deleteRuleAction } from "./actions";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { EMPTY_FORM_STATE } from "@/lib/form";

export function DeleteRule({ slug, id }: { slug: string; id: string }) {
  const [state, action, pending] = useActionState(deleteRuleAction, EMPTY_FORM_STATE);

  return (
    <details className="rounded-lg border border-border p-4">
      <summary className="cursor-pointer text-sm text-muted">Apagar regra</summary>
      <form action={action} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="id" value={id} />
        <FormError>{state.error}</FormError>
        <p className="text-sm text-muted">
          Os lançamentos que ela já categorizou continuam como estão — apagar a regra não
          reescreve o passado, só deixa de valer para o que vier.
        </p>
        <Button type="submit" variant="outline" disabled={pending} className="self-start">
          {pending ? "Apagando…" : "Apagar definitivamente"}
        </Button>
      </form>
    </details>
  );
}
