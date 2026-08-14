"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveClientAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Textarea } from "@/components/ui/field";
import { formatTaxId } from "@/lib/tax-id";
import { EMPTY_FORM_STATE } from "@/lib/form";
import type { Client } from "@/lib/data/clients";

export function ClientForm({ slug, client }: { slug: string; client: Client | null }) {
  const [state, action, pending] = useActionState(saveClientAction, EMPTY_FORM_STATE);
  const kept = (name: string, fallback: string) => state.values?.[name] ?? fallback;

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5">
      <input type="hidden" name="slug" value={slug} />
      {client ? <input type="hidden" name="id" value={client.id} /> : null}

      <FormError>{state.error}</FormError>

      <Field label="Nome" htmlFor="name">
        <Input id="name" name="name" defaultValue={kept("name", client?.name ?? "")} required />
      </Field>

      <Field
        label="CNPJ ou CPF"
        htmlFor="taxId"
        hint="É por aqui que o extrato reconhece o cliente sozinho — sem ele, a categorização depende do texto."
      >
        <Input
          id="taxId"
          name="taxId"
          defaultValue={kept("taxId", client?.taxId ? formatTaxId(client.taxId) : "")}
          placeholder="50.050.390/0001-82"
        />
      </Field>

      <Field label="Observações" htmlFor="notes">
        <Textarea id="notes" name="notes" defaultValue={kept("notes", client?.notes ?? "")} />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={state.values ? state.values.active === "on" : (client?.active ?? true)}
          className="size-4"
        />
        Cliente ativo
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
        <Link href={`/${slug}/clientes`} className="text-sm text-muted hover:text-foreground">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
