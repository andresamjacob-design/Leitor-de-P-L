/**
 * A invoice que a DD emite para a Salesforce, e a divisão dela por cliente (D148).
 *
 * A Salesforce paga em dólar um valor que é a soma de vários clientes finais, e o extrato só
 * mostra o total em reais. A invoice lista cada cliente com a parte dele:
 *
 *     ● SFA Medika - $14,000.00
 *     ● HARPIX - $7,000.00
 *
 * **O cabeçalho é imagem.** Número, data e total da invoice não existem como texto no PDF —
 * só a lista e o vencimento. O total é a soma da lista (a invoice 125 confere: US$ 31.500,00),
 * e o número vem do nome do arquivo, quando ele traz.
 *
 * Puro: recebe as linhas de texto, devolve a leitura. Dinheiro em centavos de dólar.
 */

import type { Cents } from "@/lib/money";

export type InvoiceSalesforce = {
  numero: string | null;
  /** `YYYY-MM-DD`, do "Payment Due By". */
  vencimento: string | null;
  clientes: { nome: string; usd: Cents }[];
  totalUsd: Cents;
};

const LINHA_CLIENTE = /^[●•\-*]\s*(.+?)\s+-\s+\$\s*([\d,]+\.\d{2})\s*$/;
const VENCIMENTO = /payment due by\s+(\d{1,2})[-/](\d{1,2})[-/](\d{4})/i;

export function lerInvoiceSalesforce(linhas: readonly string[], arquivo?: string): InvoiceSalesforce {
  const clientes: InvoiceSalesforce["clientes"] = [];
  let vencimento: string | null = null;
  for (const bruta of linhas) {
    const linha = bruta.trim();
    const c = LINHA_CLIENTE.exec(linha);
    if (c) {
      clientes.push({ nome: c[1]!.trim(), usd: BigInt(c[2]!.replace(/[,.]/g, "")) });
      continue;
    }
    const v = VENCIMENTO.exec(linha);
    if (v) vencimento = `${v[3]}-${v[2]!.padStart(2, "0")}-${v[1]!.padStart(2, "0")}`;
  }
  const numero = arquivo ? (/SF\s*-\s*(\d+)/i.exec(arquivo)?.[1] ?? null) : null;
  return { numero, vencimento, clientes, totalUsd: clientes.reduce((a, c) => a + c.usd, 0n) };
}

/**
 * Divide o valor recebido em reais na proporção do dólar de cada cliente.
 *
 * Maiores restos: cada parte leva o piso da sua fração, e os centavos que sobram vão para
 * quem teve o maior resto (empate: a ordem da invoice). A soma é sempre exatamente o
 * recebido — um centavo a mais ou a menos e o saldo do banco deixaria de fechar.
 */
export function dividirPorCliente(
  recebido: Cents,
  partes: readonly { nome: string; usd: Cents }[],
): { nome: string; valor: Cents }[] {
  const total = partes.reduce((a, p) => a + p.usd, 0n);
  if (total <= 0n) throw new Error("invoice sem valor");
  const base = partes.map((p, i) => ({
    i,
    nome: p.nome,
    valor: (recebido * p.usd) / total,
    resto: (recebido * p.usd) % total,
  }));
  let sobra = recebido - base.reduce((a, b) => a + b.valor, 0n);
  for (const b of [...base].sort((x, y) => (y.resto > x.resto ? 1 : y.resto < x.resto ? -1 : x.i - y.i))) {
    if (sobra === 0n) break;
    b.valor += 1n;
    sobra -= 1n;
  }
  return base.map(({ nome, valor }) => ({ nome, valor }));
}
