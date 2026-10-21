/**
 * O logo da DD Group: grafite no tema claro, branco no escuro. Os arquivos vieram do pacote
 * de marca (docs/reference, fora do git) e estão em `public/brand`.
 */
export function Marca({ className = "h-5" }: { className?: string }) {
  // `inline-flex self-start`: dentro de uma coluna flex, a imagem esticaria até a largura dela.
  return (
    <span className="inline-flex self-start">
      {/* eslint-disable-next-line @next/next/no-img-element -- PNG estático, sem otimização a fazer */}
      <img src="/brand/ddgroup-logo-grafite.png" alt="DD Group" width={1024} height={350} className={`${className} w-auto dark:hidden`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/ddgroup-logo-branco.png" alt="DD Group" width={1024} height={350} className={`${className} hidden w-auto dark:block`} />
    </span>
  );
}
