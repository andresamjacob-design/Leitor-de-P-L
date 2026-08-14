"use client";

import { useActionState } from "react";
import { runEngineAction } from "./actions";
import { Button } from "@/components/ui/button";
import { FormError, FormNotice } from "@/components/ui/field";
import { EMPTY_FORM_STATE } from "@/lib/form";

export function RunEngine({ slug, uncategorized }: { slug: string; uncategorized: number }) {
  const [state, action, pending] = useActionState(runEngineAction, EMPTY_FORM_STATE);

  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <input type="hidden" name="slug" value={slug} />
      <FormError>{state.error}</FormError>
      {state.notices?.map((notice) => <FormNotice key={notice}>{notice}</FormNotice>)}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" size="sm" disabled={pending || uncategorized === 0}>
          {pending ? "Categorizando…" : "Categorizar o que está sem categoria"}
        </Button>
        <span className="text-sm text-muted">
          {uncategorized === 0
            ? "Nenhum lançamento sem categoria."
            : `${uncategorized} lançamento${uncategorized === 1 ? "" : "s"} sem categoria.`}
        </span>
      </div>

      <p className="text-xs text-muted">
        Só mexe em lançamento que ainda não tem categoria, e só quando a confiança é alta.
        Nada que você já decidiu é reescrito.
      </p>
    </form>
  );
}
