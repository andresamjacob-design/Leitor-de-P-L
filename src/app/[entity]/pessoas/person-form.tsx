"use client";

import Link from "next/link";
import { useActionState } from "react";
import { savePersonAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { formatTaxId } from "@/lib/tax-id";
import { EMPTY_FORM_STATE } from "@/lib/form";
import type { Client } from "@/lib/data/clients";
import type { PersonRecord } from "@/lib/data/clients";

export function PersonForm({
  slug,
  person,
  clients,
}: {
  slug: string;
  person: PersonRecord | null;
  clients: Client[];
}) {
  const [state, action, pending] = useActionState(savePersonAction, EMPTY_FORM_STATE);
  const kept = (name: string, fallback: string) => state.values?.[name] ?? fallback;

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5">
      <input type="hidden" name="slug" value={slug} />
      {person ? <input type="hidden" name="id" value={person.id} /> : null}

      <FormError>{state.error}</FormError>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Nome"
          htmlFor="name"
          className="sm:col-span-2"
          hint="É por ele que um PIX de salário é reconhecido na descrição do extrato."
        >
          <Input id="name" name="name" defaultValue={kept("name", person?.name ?? "")} required />
        </Field>

        <Field label="Cargo" htmlFor="role">
          <Input id="role" name="role" defaultValue={kept("role", person?.role ?? "")} />
        </Field>

        <Field label="Squad" htmlFor="squad">
          <Input id="squad" name="squad" defaultValue={kept("squad", person?.squad ?? "")} />
        </Field>

        <Field label="Tipo" htmlFor="kind">
          <Select id="kind" name="kind" defaultValue={kept("kind", person?.kind ?? "employee")}>
            <option value="employee">Colaborador</option>
            <option value="contractor">Prestador</option>
            <option value="partner">Sócio</option>
          </Select>
        </Field>

        <Field label="Vínculo" htmlFor="bond">
          <Select id="bond" name="bond" defaultValue={kept("bond", person?.bond ?? "")}>
            <option value="">—</option>
            <option value="clt">CLT</option>
            <option value="pj">PJ</option>
            <option value="freelancer">Freelancer</option>
            <option value="estagio">Estágio</option>
            <option value="socio">Sócio</option>
          </Select>
        </Field>

        <Field label="Gestor" htmlFor="managerName">
          <Input id="managerName" name="managerName" defaultValue={kept("managerName", person?.managerName ?? "")} />
        </Field>

        <Field label="Alocado no cliente" htmlFor="clientId" hint="Opcional.">
          <Select id="clientId" name="clientId" defaultValue={kept("clientId", person?.clientId ?? "")}>
            <option value="">—</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </Select>
        </Field>

        <Field label="CPF ou CNPJ" htmlFor="taxId" className="sm:col-span-2">
          <Input
            id="taxId"
            name="taxId"
            defaultValue={kept("taxId", person?.taxId ? formatTaxId(person.taxId) : "")}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={state.values ? state.values.active === "on" : (person?.active ?? true)}
          className="size-4"
        />
        Pessoa ativa
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar"}</Button>
        <Link href={`/${slug}/pessoas`} className="text-sm text-muted hover:text-foreground">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
