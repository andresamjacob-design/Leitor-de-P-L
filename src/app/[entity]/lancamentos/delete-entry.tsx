"use client";

import { useActionState } from "react";
import { deleteCashEntryAction } from "./actions";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { EMPTY_FORM_STATE } from "@/lib/form";

/**
 * Deleting is deliberately two clicks and no browser dialog: a `confirm()` blocks the
 * page and cannot be tested, and this makes the consequence readable before you commit
 * to it.
 */
export function DeleteEntry({
  slug,
  id,
  pairedNotice,
}: {
  slug: string;
  id: string;
  pairedNotice: boolean;
}) {
  const [state, action, pending] = useActionState(deleteCashEntryAction, EMPTY_FORM_STATE);

  return (
    <details className="rounded-lg border border-border p-4">
      <summary className="cursor-pointer text-sm text-muted">Apagar lançamento</summary>
      <form action={action} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="id" value={id} />
        <FormError>{state.error}</FormError>
        <p className="text-sm text-muted">
          A linha de competência gerada por ele vai junto.
          {pairedNotice ? " A contrapartida da transferência também." : ""} A exclusão fica
          registrada na auditoria.
        </p>
        <Button type="submit" variant="outline" disabled={pending} className="self-start">
          {pending ? "Apagando…" : "Apagar definitivamente"}
        </Button>
      </form>
    </details>
  );
}
