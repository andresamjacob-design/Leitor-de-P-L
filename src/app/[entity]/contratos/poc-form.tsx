"use client";

import { useActionState } from "react";
import { savePocAction, runRecognitionAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormNotice, Input } from "@/components/ui/field";
import { EMPTY_FORM_STATE } from "@/lib/form";

/** Reporting cumulative percent, and re-running the engine right after. */
export function PocForm({
  slug,
  contractId,
  defaultPeriod,
  lastCumulative,
}: {
  slug: string;
  contractId: string;
  defaultPeriod: string;
  lastCumulative: string | null;
}) {
  const [state, action, pending] = useActionState(savePocAction, EMPTY_FORM_STATE);

  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="contractId" value={contractId} />

      <FormError>{state.error}</FormError>
      {state.notices?.map((notice) => <FormNotice key={notice}>{notice}</FormNotice>)}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mês" htmlFor="period">
          <Input id="period" name="period" type="month" defaultValue={defaultPeriod} required />
        </Field>

        <Field
          label="% concluído (acumulado)"
          htmlFor="cumulative"
          hint={
            lastCumulative === null
              ? "O total do projeto até aqui, não o avanço do mês."
              : `Último reporte: ${lastCumulative}%. O sistema calcula a diferença.`
          }
        >
          <Input id="cumulative" name="cumulative" inputMode="decimal" placeholder="30" required />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isCorrection" className="size-4" />
        É uma correção — o acumulado pode cair
      </label>

      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {pending ? "Gravando…" : "Reportar"}
      </Button>
    </form>
  );
}

/** Re-runs the engine without reporting anything new. */
export function RunRecognition({
  slug,
  contractId,
  label,
}: {
  slug: string;
  contractId?: string;
  label: string;
}) {
  const [state, action, pending] = useActionState(runRecognitionAction, EMPTY_FORM_STATE);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="slug" value={slug} />
      {contractId ? <input type="hidden" name="contractId" value={contractId} /> : null}

      <FormError>{state.error}</FormError>
      {state.notices?.map((notice) => <FormNotice key={notice}>{notice}</FormNotice>)}

      <Button type="submit" variant="outline" size="sm" disabled={pending} className="self-start">
        {pending ? "Reconhecendo…" : label}
      </Button>
    </form>
  );
}
