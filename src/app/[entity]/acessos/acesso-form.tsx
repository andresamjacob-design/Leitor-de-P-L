"use client";

import { useActionState } from "react";
import { definirAcessoAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { EMPTY_FORM_STATE } from "@/lib/form";
import { PAPEL_DESCRICAO, PAPEL_LABEL, type Papel } from "@/lib/data/acessos";

const PAPEIS: Papel[] = ["viewer", "member", "owner"];

/** Liberar alguém novo, por e-mail. A pessoa não precisa ter entrado antes. */
export function NovoAcessoForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(definirAcessoAction, EMPTY_FORM_STATE);
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-4">
      <input type="hidden" name="slug" value={slug} />
      <FormError>{state.error}</FormError>
      {state.notices?.map((n) => (
        <p key={n} role="status" className="text-sm text-green-700 dark:text-green-400">
          {n}
        </p>
      ))}
      <div className="grid gap-4 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
        <Field label="E-mail" htmlFor="novo-email">
          <Input
            id="novo-email"
            name="email"
            type="email"
            required
            placeholder="nome@ddgroup.com.br"
            defaultValue={state.values?.email ?? ""}
          />
        </Field>
        <Field label="Pode" htmlFor="novo-papel">
          <Select id="novo-papel" name="papel" defaultValue={state.values?.papel ?? "viewer"}>
            {PAPEIS.map((p) => (
              <option key={p} value={p}>
                {PAPEL_LABEL[p]} — {PAPEL_DESCRICAO[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Liberando…" : "Liberar"}
        </Button>
      </div>
    </form>
  );
}

/** Mudar ou tirar o acesso de uma pessoa da lista. */
export function MudarAcessoForm({ slug, email, papel }: { slug: string; email: string; papel: Papel | null }) {
  const [state, action, pending] = useActionState(definirAcessoAction, EMPTY_FORM_STATE);
  const id = `papel-${email.replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="email" value={email} />
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Acesso de {email}
        </label>
        <Select id={id} name="papel" defaultValue={papel ?? "remover"} className="h-8 text-sm">
          {papel === null ? <option value="remover">Sem acesso</option> : null}
          {PAPEIS.map((p) => (
            <option key={p} value={p}>
              {PAPEL_LABEL[p]}
            </option>
          ))}
          {papel !== null ? <option value="remover">Tirar acesso</option> : null}
        </Select>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "…" : "Salvar"}
        </Button>
      </div>
      {state.error ? <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p> : null}
      {state.notices?.map((n) => (
        <p key={n} className="text-xs text-green-700 dark:text-green-400">
          {n}
        </p>
      ))}
    </form>
  );
}
