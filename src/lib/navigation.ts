/** The sidebar. Each item says which phase actually fills it in. */
export const NAV_ITEMS = [
  { href: "", label: "Visão geral", phase: "Fase 8" },
  { href: "/fluxo-de-caixa", label: "Fluxo de caixa", phase: "Fase 2" },
  { href: "/dre", label: "DRE gerencial", phase: "Fase 6" },
  { href: "/lancamentos", label: "Lançamentos", phase: "Fase 2" },
  { href: "/importacoes", label: "Importações", phase: "Fase 3" },
  { href: "/contratos", label: "Contratos", phase: "Fase 5" },
  { href: "/notas-fiscais", label: "Notas fiscais", phase: "Fase 5" },
  { href: "/clientes", label: "Clientes", phase: "Fase 5" },
  { href: "/pessoas", label: "Pessoas", phase: "Fase 5" },
  { href: "/assinaturas", label: "Assinaturas", phase: "Fase 4" },
  { href: "/auditoria", label: "Auditoria", phase: "Fase 8" },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
