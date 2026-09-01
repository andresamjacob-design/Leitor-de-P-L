/**
 * O mapa entre as linhas da `DRE Geral` e o plano de contas.
 *
 * Mora num módulo próprio, sem efeito nenhum, porque **dois scripts precisam dele** — o
 * `propose:rules`, que escreve regra de texto a partir das linhas, e o `comparar`, que põe
 * as duas DREs lado a lado. Importar de dentro de um script executaria o script: a primeira
 * versão do `comparar` rodava um `propose:rules` inteiro de brinde, contra o banco, só por
 * causa de um `import`.
 *
 * Duplicar também não servia. O plano de contas foi construído a partir destas linhas; duas
 * cópias divergem no dia em que alguém corrige uma só, e aí os dois relatórios discordam
 * sem que nenhum esteja errado.
 */

/** Linha da planilha → código do plano de contas. */
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

