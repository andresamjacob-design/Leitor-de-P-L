import { NextResponse, type NextRequest } from "next/server";
import { resolveScope } from "@/lib/entities";
import { getUser } from "@/lib/supabase/server";
import { buildReport, isReportName, type ReportName } from "@/lib/export/reports";
import { writeCsv, writeXlsx } from "@/lib/export/xlsx";
import { todayInSaoPaulo } from "@/lib/dates";

/**
 * Downloading a report.
 *
 * The route calls the same loaders the screens call, so the file carries the same numbers
 * as the page it came from (SPEC §10). RLS still applies — the request runs with the
 * user's JWT like every other read, and a scope the user cannot reach 404s.
 *
 *   /dd-group/export/dre?formato=xlsx&de=2026-01&ate=2026-12
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entity: string; relatorio: string }> },
) {
  const { entity: slug, relatorio } = await params;

  // A route handler has no layout above it, so the session check that protects every page
  // has to be repeated here. The proxy already turns anonymous traffic away, and RLS would
  // return nothing anyway — this is the third lock, and the only one on this file.
  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(new URL(`/login?redirect=/${slug}`, request.nextUrl));
  }

  if (!isReportName(relatorio)) {
    return NextResponse.json({ erro: "relatório desconhecido" }, { status: 404 });
  }

  const scope = await resolveScope(slug);
  if (!scope) return NextResponse.json({ erro: "não encontrado" }, { status: 404 });

  const search = request.nextUrl.searchParams;
  const format = search.get("formato") === "csv" ? "csv" : "xlsx";
  const year = todayInSaoPaulo().slice(0, 4);

  const month = (value: string | null, fallback: string) =>
    /^\d{4}-\d{2}$/.test(value ?? "") ? `${value}-01` : fallback;

  const from = month(search.get("de"), `${year}-01-01`);
  const to = month(search.get("ate"), `${year}-12-01`);
  if (to < from) {
    return NextResponse.json({ erro: "intervalo inválido" }, { status: 400 });
  }

  const entities = scope.kind === "consolidated" ? scope.entities : [scope.entity];

  let sheets;
  try {
    sheets = await buildReport({
      report: relatorio as ReportName,
      entities,
      consolidated: scope.kind === "consolidated",
      from,
      to,
    });
  } catch (cause) {
    return NextResponse.json(
      { erro: cause instanceof Error ? cause.message : "falha ao montar o relatório" },
      { status: 500 },
    );
  }

  if (sheets.length === 0) {
    return NextResponse.json({ erro: "o relatório não produziu nada" }, { status: 404 });
  }

  const stamp = `${from.slice(0, 7)}_${to.slice(0, 7)}`;
  const base = `${slug}_${relatorio}_${stamp}`;

  if (format === "csv") {
    // CSV is one table; a multi-sheet report exports its first sheet, and the file name
    // says which one so nobody thinks the rest went missing.
    const sheet = sheets[0] as (typeof sheets)[number];
    const name = sheets.length > 1 ? `${base}_${slugify(sheet.name)}.csv` : `${base}.csv`;
    return new NextResponse(writeCsv(sheet.rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  }

  const bytes = writeXlsx(sheets);
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${base}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const dynamic = "force-dynamic";
