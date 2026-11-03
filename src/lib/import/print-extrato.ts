/**
 * Extrato lido de prints da tela do banco (D168).
 *
 * O BS2 da GSJacob não exporta nada — nem pdf, nem xlsx. O único registro que o banco dá
 * é a tela do app, então o Andre tira prints e a IA (com visão) os transcreve.
 *
 * Isto é a única exceção à regra de que a IA nunca produz um valor (SPEC §8), e ela é
 * cercada dos dois lados, como os contratos do §9:
 *
 *   **A IA transcreve, o código converte.** O modelo devolve cada valor como o texto que
 *   está impresso (`"1.234,56"`), nunca como número. Quem vira centavos é o `parseMoney`,
 *   o mesmo dos outros leitores. Um texto que não é dinheiro é descartado, e não adivinhado.
 *
 *   **Nunca entra sozinho.** Diferente do extrato do Itaú (D145), a importação de print
 *   sempre espera revisão linha a linha. O saldo do próprio print confere a leitura — saldo
 *   inicial + movimentos = saldo final —, mas mesmo fechando a conta não pula a revisão:
 *   duas linhas trocadas de lugar fecham a soma e erram a data.
 *
 * Puro: o prompt, o schema e a validação da resposta. A chamada fica em `actions.ts`.
 */

import { formatMoney, parseMoney, type Cents } from "@/lib/money";
import { parsePtBRDate, type IsoDate } from "@/lib/dates";
import type {
  DiscardedRow,
  ParsedTransaction,
  ParseWarning,
  Reconciliation,
  StatementParse,
} from "@/lib/import/types";

export const PRINT_SYSTEM_PROMPT = `Você transcreve prints de extrato bancário de um app de banco brasileiro.

Recebe um ou mais prints, na ordem em que foram tirados, de UM mesmo extrato. Prints
seguidos costumam se sobrepor (a rolagem repete linhas): cada movimento deve aparecer UMA
vez só na resposta, mesmo que esteja em dois prints.

Regras:
- Transcreva, não calcule. "valor" e os saldos são o texto exatamente como aparece na tela
  (ex.: "1.234,56"), sem "R$" e sem sinal. O sentido vai em "sentido".
- "sentido" é "entrada" quando o dinheiro entrou na conta e "saida" quando saiu. Use o
  sinal, a cor ou a palavra da tela (Pix recebido, Pix enviado, TED, pagamento).
- "data" é dd/mm/aaaa. Se a tela agrupa por dia ("12 de outubro"), use o ano que aparece
  em algum lugar dos prints; se nenhum ano aparece, use null.
- "saldo_inicial" e "saldo_final" só se a tela mostrar esses saldos; caso contrário, null.
  "saldo_apos" é o saldo impresso depois daquele movimento, se a tela mostrar; senão null.
- "print" é o número do print (1 para o primeiro) onde a linha aparece primeiro.
- Uma linha que você não consegue ler com certeza vai em "ilegiveis", não em "movimentos".
  É melhor deixar de fora do que chutar um dígito.
- Não invente agência, conta ou CNPJ: o que não está na tela é null.`;

export const PRINT_PROMPT = `Transcreva o extrato destes prints no formato do schema.`;

const TEXTO_OU_NULO = { type: ["string", "null"] } as const;

const SALDO = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["data", "valor"],
  properties: { data: TEXTO_OU_NULO, valor: { type: "string" } },
} as const;

/** O formato que a IA é obrigada a devolver (`output_config.format`). */
export const PRINT_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["banco", "agencia", "conta", "titular", "saldo_inicial", "saldo_final", "movimentos", "ilegiveis"],
  properties: {
    banco: TEXTO_OU_NULO,
    agencia: TEXTO_OU_NULO,
    conta: TEXTO_OU_NULO,
    titular: TEXTO_OU_NULO,
    saldo_inicial: SALDO,
    saldo_final: SALDO,
    movimentos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["data", "descricao", "valor", "sentido", "contraparte", "documento", "saldo_apos", "print"],
        properties: {
          data: TEXTO_OU_NULO,
          descricao: { type: "string" },
          valor: { type: "string" },
          sentido: { type: "string", enum: ["entrada", "saida"] },
          contraparte: TEXTO_OU_NULO,
          documento: TEXTO_OU_NULO,
          saldo_apos: TEXTO_OU_NULO,
          print: { type: "integer" },
        },
      },
    },
    ilegiveis: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["print", "trecho", "motivo"],
        properties: { print: { type: "integer" }, trecho: { type: "string" }, motivo: { type: "string" } },
      },
    },
  },
};

type Saldo = { data: string | null; valor: string } | null;

export type RespostaDoPrint = {
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  titular: string | null;
  saldo_inicial: Saldo;
  saldo_final: Saldo;
  movimentos: {
    data: string | null;
    descricao: string;
    valor: string;
    sentido: "entrada" | "saida";
    contraparte: string | null;
    documento: string | null;
    saldo_apos: string | null;
    print: number;
  }[];
  ilegiveis: { print: number; trecho: string; motivo: string }[];
};

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/** CPF mascarado (`709.***.***-26`) não identifica ninguém e nunca vira documento. */
function documento(valor: string | null): string | null {
  if (valor === null || valor.includes("*")) return null;
  const digitos = valor.replace(/\D/g, "");
  return digitos.length === 11 || digitos.length === 14 ? digitos : null;
}

/** Dinheiro impresso, em magnitude. O sinal nunca vem daqui: vem de `sentido`. */
function dinheiro(valor: string): Cents | null {
  try {
    const centavos = parseMoney(valor.replace(/^[+-]\s*/, ""), { decimalSeparator: "," });
    return centavos < 0n ? -centavos : centavos;
  } catch {
    return null;
  }
}

function dia(valor: string | null): IsoDate | null {
  if (valor === null) return null;
  try {
    return parsePtBRDate(valor);
  } catch {
    return null;
  }
}

/**
 * A resposta da IA, conferida campo a campo e virada no mesmo `StatementParse` que os
 * outros leitores devolvem. O que não passa vai para `discarded` com o motivo — a tela
 * mostra, porque o silêncio pareceria cobertura (D127).
 */
export function lerRespostaDoPrint(resposta: unknown): StatementParse {
  if (typeof resposta !== "object" || resposta === null || !Array.isArray((resposta as RespostaDoPrint).movimentos)) {
    throw new Error("a IA não devolveu um extrato reconhecível destes prints.");
  }
  const r = resposta as RespostaDoPrint;

  const transactions: ParsedTransaction[] = [];
  const discarded: DiscardedRow[] = [];
  const warnings: ParseWarning[] = [];
  const declaredBalances: StatementParse["declaredBalances"] = [];

  r.movimentos.forEach((movimento, indice) => {
    const linha = indice + 1;
    const descricao = texto(movimento.descricao) ?? "(sem descrição)";
    const occurredOn = dia(texto(movimento.data));
    if (occurredOn === null) {
      discarded.push({ line: linha, description: descricao, reason: `data ilegível (“${movimento.data ?? ""}”)` });
      return;
    }
    const amount = dinheiro(String(movimento.valor ?? ""));
    if (amount === null || amount === 0n) {
      discarded.push({ line: linha, description: descricao, reason: `valor ilegível (“${movimento.valor}”)` });
      return;
    }
    if (movimento.sentido !== "entrada" && movimento.sentido !== "saida") {
      discarded.push({ line: linha, description: descricao, reason: "sem sentido (entrada ou saída)" });
      return;
    }

    transactions.push({
      occurredOn,
      description: descricao,
      amount,
      direction: movimento.sentido === "entrada" ? "in" : "out",
      counterpartyName: texto(movimento.contraparte),
      counterpartyTaxId: documento(texto(movimento.documento)),
      installmentCurrent: null,
      installmentTotal: null,
      externalId: null,
      raw: {
        print: String(movimento.print),
        data: movimento.data,
        descricao: movimento.descricao,
        valor: movimento.valor,
        sentido: movimento.sentido,
        contraparte: movimento.contraparte,
        documento: movimento.documento,
        saldo_apos: movimento.saldo_apos,
      },
    });

    const saldoApos = texto(movimento.saldo_apos);
    if (saldoApos !== null) {
      try {
        declaredBalances.push({ date: occurredOn, balance: parseMoney(saldoApos, { decimalSeparator: "," }), label: `saldo após “${descricao}”` });
      } catch {
        // Um saldo ilegível só deixa de conferir; o movimento continua valendo.
      }
    }
  });

  for (const ilegivel of r.ilegiveis ?? []) {
    discarded.push({ line: 0, description: `print ${ilegivel.print}: ${ilegivel.trecho}`, reason: ilegivel.motivo });
  }

  const inicial = r.saldo_inicial ? dinheiroComSinal(r.saldo_inicial.valor) : null;
  const final = r.saldo_final ? dinheiroComSinal(r.saldo_final.valor) : null;
  const datas = transactions.map((t) => t.occurredOn).sort();
  const periodStart = dia(r.saldo_inicial?.data ?? null) ?? datas[0] ?? null;
  const periodEnd = dia(r.saldo_final?.data ?? null) ?? datas[datas.length - 1] ?? null;
  if (final !== null && periodEnd !== null) {
    declaredBalances.push({ date: periodEnd, balance: final, label: "saldo final do print" });
  }
  if (inicial === null) {
    warnings.push({ severity: "warning", message: "o print não mostra saldo inicial: a leitura não tem como ser conferida pela soma." });
  }

  return {
    kind: "statement",
    source: {
      institution: texto(r.banco) ?? "desconhecido",
      branch: texto(r.agencia),
      account: texto(r.conta),
      holder: texto(r.titular),
    },
    periodStart,
    periodEnd,
    transactions,
    declaredBalances,
    openingBalance: inicial,
    discarded,
    warnings,
  };
}

/** Saldo pode ser negativo (cheque especial), e aí o sinal impresso vale. */
function dinheiroComSinal(valor: string): Cents | null {
  try {
    return parseMoney(valor, { decimalSeparator: "," });
  } catch {
    return null;
  }
}

/**
 * Saldo inicial + movimentos = saldo final, os dois lidos do próprio print.
 *
 * Uma linha esquecida na emenda entre dois prints, ou repetida porque a rolagem a mostrou
 * duas vezes, quebra esta conta — é o erro mais provável de uma leitura por print.
 */
export function conferirPrint(parse: StatementParse): Reconciliation {
  const actual = parse.transactions.reduce(
    (soma, t) => soma + (t.direction === "in" ? t.amount : -t.amount),
    0n,
  );
  const final = [...parse.declaredBalances].reverse().find((b) => b.label === "saldo final do print");
  if (parse.openingBalance === null || !final) {
    return {
      ok: false,
      expected: null,
      actual,
      difference: 0n,
      message: "o print não mostra saldo inicial e final, então só a revisão confere a leitura.",
    };
  }
  const expected = final.balance - parse.openingBalance;
  const difference = actual - expected;
  return {
    ok: difference === 0n,
    expected,
    actual,
    difference,
    message:
      difference === 0n
        ? `${parse.transactions.length} movimentos fecham com o saldo do print ` +
          `(${formatMoney(parse.openingBalance)} → ${formatMoney(final.balance)}).`
        : `a leitura não fecha com o saldo do print: os movimentos somam ${formatMoney(actual)} ` +
          `e o print vai de ${formatMoney(parse.openingBalance)} a ${formatMoney(final.balance)} ` +
          `(diferença de ${formatMoney(difference)}). Confira se algum movimento ficou de fora ` +
          "ou apareceu duas vezes na emenda entre prints.",
  };
}
