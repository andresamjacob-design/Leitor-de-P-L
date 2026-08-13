/** The sidebar. `phase` marks what is not built yet, so nothing pretends to work. */
export const NAV_ITEMS = [
  { href: "", label: "Visão geral", phase: "Fase 8" },
  { href: "/fluxo-de-caixa", label: "Fluxo de caixa", phase: null },
  { href: "/dre", label: "DRE gerencial", phase: "Fase 6" },
  { href: "/lancamentos", label: "Lançamentos", phase: null },
  { href: "/importacoes", label: "Importações", phase: "Fase 3" },
  { href: "/contratos", label: "Contratos", phase: "Fase 5" },
  { href: "/notas-fiscais", label: "Notas fiscais", phase: "Fase 5" },
  { href: "/clientes", label: "Clientes", phase: "Fase 5" },
  { href: "/pessoas", label: "Pessoas", phase: "Fase 5" },
  { href: "/assinaturas", label: "Assinaturas", phase: "Fase 4" },
  { href: "/contas", label: "Contas", phase: null },
  { href: "/plano-de-contas", label: "Plano de contas", phase: null },
  { href: "/auditoria", label: "Auditoria", phase: "Fase 8" },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
