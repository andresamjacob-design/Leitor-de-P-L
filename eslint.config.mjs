import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "playwright-report/**",
      "test-results/**",
      // Andaime de ferramentas, não código deste projeto. O `ruflo init` deixa helpers em
      // CommonJS que violam as regras daqui — e corrigi-los seria editar código de
      // terceiro que a próxima atualização sobrescreve.
      ".claude/**",
      ".claude-flow/**",
      ".agents/**",
      ".swarm/**",
    ],
  },
];

export default config;
