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
export { TO_CODE } from "@/lib/linhas-da-planilha";
