/**
 * O mapa entre as linhas das planilhas do Andre e o plano de contas.
 *
 * Morava em `scripts/plano-de-contas.ts`, usado pelo `propose:rules` e pelos dois
 * comparadores. Veio para cá quando a **tela** passou a precisar dele (D146): a aba Fluxo
 * preenche os meses que a planilha ainda não tem com o cálculo do app, nas mesmas linhas
 * dela, e para isso precisa saber que `Gsuite` é a conta `7.01`. O script reexporta daqui —
 * uma cópia só, porque duas divergem no dia em que alguém corrige uma.
 */

export const TO_CODE: Record<string, string> = {
  Salários: "6.02",
  Férias: "6.03",
  "13º Salário": "6.04",
  "Plano de Saude": "6.06",
  "Seguro Saúde (estag)": "6.07",
  "Ticket Restaurante": "6.08",
  VT: "6.09",
  Freelancers: "6.10",
  Clicksign: "7.07",
  Gsuite: "7.01",
  Wix: "7.10",
  Slack: "7.05",
  Tarefy: "7.08",
  Plaud: "7.14",
  Salesforce: "7.02",
  Adobe: "7.11",
  "Escola.i": "7.09",
  Claude: "7.03",
  Trello: "7.06",
  Canva: "7.12",
  Vindi: "7.13",
  NeverBounce: "7.15",
  Scribd: "7.16",
  ChatGPT: "7.04",
  Locaweb: "7.17",
  Tactic: "7.18",
  "Railway Corporation": "7.19",
  Linkedin: "7.20",
  Contabilidade: "8.01",
  Juridico: "8.02",
  "Agência Ciclo": "8.03",
  Passagem: "9.01",
  Hotels: "9.02",
  Alimentação: "9.03",
  "Travel Meals": "9.03",
  "Uber e Transporte": "9.04",
  "Viagem e evento": "9.05",
  Entertainment: "9.06",
  "Claro e TIM": "10.01",
  Brindes: "10.02",
  "Job Materials": "10.03",
  "Reembolsos Comercial": "10.04",
  Outros: "10.05",
  "Bank Charges": "11.01",
  IOF: "11.02",
  "Penalties & Settlements": "11.03",
  Maquinas: "5.01",
};


/**
 * As linhas do **fluxo** que têm nome diferente na `DRE Geral`, ou que juntam mais de uma
 * conta. O resto sai do `TO_CODE`. Era o `APELIDOS` do `comparar:fluxo`.
 */
export const APELIDOS_DO_FLUXO: Record<string, string[]> = {
  /**
   * A Agência Ciclo (`8.03`) não tem linha na aba `Expenses`, e a planilha a conta dentro de
   * `Pessoas` (D125). Sem ela aqui, o fluxo calculado pelo app deixava R$ 4.000/mês em
   * "Outras saídas" e `Pessoas` ficava R$ 16.000 abaixo da planilha em janeiro a abril (D146).
   */
  "Time - Interno": ["6.10", "8.03"],
  "Time - Freelancers": ["6.10"],
  "Distribuição de Lucro": ["6.11", "99.04"],
  "Legal & Professional Fees": ["8.02"],
  "Plano de saude": ["6.06"],
  "Insurance - Estags": ["6.07"],
  Other: ["10.05"],
  "Máquinas e Computadores": ["5.01"],
  Imposto: ["4.01"],
  // A conta que a D117 criou: freelancer que é empresa, separado do time nos dois arquivos.
  "Freelancer (outras empresas)": ["6.12"],
  /**
   * As três linhas de receita, medidas contra janeiro a agosto (D146). A `Receita
   * Salesforce` é a `3.03` — a `3.04` nunca recebeu um centavo — e bate em 6 de 8 meses.
   * `Ongoing` e `Projetos` são a `3.01` e a `3.02`, mas a divisão entre elas não é a dele: o
   * app separa pelo contrato do cliente, e ele às vezes lança o mesmo cliente na outra. O
   * total de `Sales`, esse, fecha.
   */
  "Receita Ongoing": ["3.01"],
  "Receita Projetos": ["3.02"],
  "Receita Salesforce": ["3.03", "3.04"],
  // `REND PAGO APLIC AUT`: o Andre conta no Income (D150). O rendimento que fica no CDB, não.
  "Interest Earned": ["11.05"],
};

/** `- Clicksign (cartão de credito)` → `Clicksign`: o rótulo como a `DRE Geral` o escreve. */
export function normalizarRotulo(bruto: string): string {
  return bruto
    .replace(/^-\s*/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

/** As contas de uma linha do fluxo, ou `null` se a linha não corresponde a conta nenhuma. */
export function contasDaLinha(rotulo: string): string[] | null {
  const limpo = normalizarRotulo(rotulo);
  return (
    APELIDOS_DO_FLUXO[rotulo] ??
    APELIDOS_DO_FLUXO[limpo] ??
    (TO_CODE[limpo] ? [TO_CODE[limpo] as string] : null)
  );
}
