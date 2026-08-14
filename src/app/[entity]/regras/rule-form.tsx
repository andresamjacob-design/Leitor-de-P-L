"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveRuleAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { formatTaxId } from "@/lib/tax-id";
import { EMPTY_FORM_STATE } from "@/lib/form";
import type { Rule, MatchType } from "@/lib/categorize/types";
import type { Category } from "@/lib/data/categories";
import type { Account } from "@/lib/data/accounts";

const MATCH_LABEL: Record<MatchType, string> = {
  contains: "Contém o texto",
  exact: "É exatamente o texto",
  regex: "Casa com a expressão regular",
  amount_range: "Só pela faixa de valor",
};

export function RuleForm({
  slug,
  rule,
  categories,
  accounts,
}: {
  slug: string;
  rule: Rule | null;
  categories: Category[];
  accounts: Account[];
}) {
  const [state, action, pending] = useActionState(saveRuleAction, EMPTY_FORM_STATE);
  const kept = (name: string, fallback: string) => state.values?.[name] ?? fallback;
  const [matchType, setMatchType] = useState<MatchType>(rule?.matchType ?? "contains");

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5">
      <input type="hidden" name="slug" value={slug} />
      {rule ? <input type="hidden" name="id" value={rule.id} /> : null}

      <FormError>{state.error}</FormError>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Comparação"
          htmlFor="matchType"
          className="sm:col-span-2"
          hint="O texto é comparado sem acento e sem diferenciar maiúsculas."
        >
          <Select
            id="matchType"
            name="matchType"
            value={matchType}
            onChange={(event) => setMatchType(event.target.value as MatchType)}
          >
            {(Object.keys(MATCH_LABEL) as MatchType[]).map((type) => (
              <option key={type} value={type}>
                {MATCH_LABEL[type]}
              </option>
            ))}
          </Select>
        </Field>

        {matchType === "amount_range" ? null : (
          <Field
            label="Padrão"
            htmlFor="pattern"
            className="sm:col-span-2"
            hint="Use “*” para casar por CNPJ apenas, sem olhar a descrição."
          >
            <Input
              id="pattern"
              name="pattern"
              defaultValue={kept("pattern", rule?.pattern ?? "")}
              placeholder="UBER"
            />
          </Field>
        )}

        <Field
          label="CNPJ ou CPF da contraparte"
          htmlFor="counterpartyTaxId"
          className="sm:col-span-2"
          hint="Quando preenchido, a regra só vale para essa contraparte — e passa na frente de qualquer regra por texto."
        >
          <Input
            id="counterpartyTaxId"
            name="counterpartyTaxId"
            defaultValue={kept(
              "counterpartyTaxId",
              rule?.counterpartyTaxId ? formatTaxId(rule.counterpartyTaxId) : "",
            )}
            placeholder="50.050.390/0001-82"
          />
        </Field>

        <Field label="Valor mínimo" htmlFor="amountMin" hint="Opcional.">
          <Input
            id="amountMin"
            name="amountMin"
            inputMode="decimal"
            defaultValue={kept("amountMin", rule?.amountMin ? formatMoney(rule.amountMin) : "")}
            placeholder="0,00"
          />
        </Field>

        <Field label="Valor máximo" htmlFor="amountMax" hint="Opcional.">
          <Input
            id="amountMax"
            name="amountMax"
            inputMode="decimal"
            defaultValue={kept("amountMax", rule?.amountMax ? formatMoney(rule.amountMax) : "")}
            placeholder="0,00"
          />
        </Field>

        <Field label="Categoria" htmlFor="categoryId" className="sm:col-span-2">
          <Select
            id="categoryId"
            name="categoryId"
            defaultValue={kept("categoryId", rule?.categoryId ?? "")}
            required
          >
            <option value="">Escolha…</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.code} · {category.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Só nesta conta" htmlFor="accountId" hint="Opcional.">
          <Select id="accountId" name="accountId" defaultValue={kept("accountId", rule?.accountId ?? "")}>
            <option value="">Qualquer conta</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Prioridade"
          htmlFor="priority"
          hint="Menor decide primeiro quando mais de uma regra casa."
        >
          <Input
            id="priority"
            name="priority"
            type="number"
            defaultValue={kept("priority", String(rule?.priority ?? 100))}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={state.values ? state.values.active === "on" : (rule?.active ?? true)}
          className="size-4"
        />
        Regra ativa
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
        <Link href={`/${slug}/regras`} className="text-sm text-muted hover:text-foreground">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
