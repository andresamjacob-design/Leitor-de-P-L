/** The sidebar. `phase` marks what is not built yet, so nothing pretends to work. */
export const NAV_ITEMS = [
  { href: "", label: "Visão geral", phase: null },
  { href: "/fluxo-de-caixa", label: "Fluxo de caixa", phase: null },
  { href: "/dre", label: "DRE gerencial", phase: null },
  { href: "/competencia", label: "Competência", phase: null },
  { href: "/receita", label: "Receita", phase: null },
  { href: "/folha", label: "Folha", phase: null },
  { href: "/margem", label: "Margem por cliente", phase: null },
  { href: "/lancamentos", label: "Lançamentos", phase: null },
  { href: "/importacoes", label: "Importações", phase: null },
  { href: "/contratos", label: "Contratos", phase: null },
  { href: "/contratos/poc", label: "Reportar avanço", phase: null },
  { href: "/contratos/extrair", label: "Ler contrato", phase: null },
  { href: "/notas-fiscais", label: "Notas fiscais", phase: null },
  { href: "/clientes", label: "Clientes", phase: null },
  { href: "/pessoas", label: "Pessoas", phase: null },
  { href: "/assinaturas", label: "Assinaturas", phase: null },
  { href: "/regras", label: "Regras", phase: null },
  { href: "/contas", label: "Contas", phase: null },
  { href: "/plano-de-contas", label: "Plano de contas", phase: null },
  { href: "/auditoria", label: "Auditoria", phase: null },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
