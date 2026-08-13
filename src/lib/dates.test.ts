import { describe, expect, it } from "vitest";
import {
  addMonths,
  coveredDays,
  daysInMonth,
  eachPeriod,
  formatPeriod,
  formatPeriodShort,
  formatPtBRDate,
  monthsBetween,
  parsePtBRDate,
  periodOf,
  todayInSaoPaulo,
} from "./dates";

describe("pt-BR parsing and formatting", () => {
  it("round-trips dd/mm/aaaa", () => {
    expect(parsePtBRDate("15/04/2026")).toBe("2026-04-15");
    expect(parsePtBRDate("1/3/2026")).toBe("2026-03-01");
    expect(formatPtBRDate("2026-04-15")).toBe("15/04/2026");
  });

  it("rejects impossible dates instead of rolling them over", () => {
    expect(() => parsePtBRDate("31/02/2026")).toThrow();
    expect(() => parsePtBRDate("2026-04-15")).toThrow();
    expect(() => parsePtBRDate("")).toThrow();
  });
});

describe("periods", () => {
  it("reduces a date to the first of its month", () => {
    expect(periodOf("2026-03-10")).toBe("2026-03-01");
    expect(periodOf("2026-12-31")).toBe("2026-12-01");
  });

  it("names periods in Portuguese", () => {
    expect(formatPeriod("2026-03-01")).toBe("março de 2026");
    expect(formatPeriodShort("2026-03-01")).toBe("mar/26");
  });

  it("counts months between periods", () => {
    expect(monthsBetween("2026-03-01", "2026-07-01")).toBe(4);
    expect(monthsBetween("2026-03-01", "2026-03-01")).toBe(0);
    expect(monthsBetween("2026-03-01", "2025-12-01")).toBe(-3);
  });

  it("lists the months of a term", () => {
    // The 5-month project from SPEC §11.1.
    expect(eachPeriod("2026-03-01", "2026-07-31")).toEqual([
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
    ]);
    expect(eachPeriod("2026-07-01", "2026-03-01")).toEqual([]);
  });

  it("clamps when adding months to a long day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("knows month lengths, leap years included", () => {
    expect(daysInMonth("2026-04-01")).toBe(30);
    expect(daysInMonth("2026-02-01")).toBe(28);
    expect(daysInMonth("2024-02-01")).toBe(29);
  });
});

describe("coveredDays — proration (DECISIONS D14f)", () => {
  it("prorates the first month by real days, counting the start day", () => {
    // SPEC §11.3: retainer starting 15/04 → 16 of April's 30 days.
    expect(coveredDays("2026-04-01", "2026-04-15", null)).toEqual({
      covered: 16,
      total: 30,
    });
  });

  it("uses the real length of a 31-day month", () => {
    expect(coveredDays("2026-03-01", "2026-03-15", null)).toEqual({
      covered: 17,
      total: 31,
    });
  });

  it("gives a full month once the term has started", () => {
    expect(coveredDays("2026-05-01", "2026-04-15", null)).toEqual({
      covered: 31,
      total: 31,
    });
  });

  it("prorates the last month too", () => {
    expect(coveredDays("2026-06-01", "2026-01-01", "2026-06-10")).toEqual({
      covered: 10,
      total: 30,
    });
  });

  it("covers nothing outside the term", () => {
    expect(coveredDays("2026-03-01", "2026-04-15", null).covered).toBe(0);
    expect(coveredDays("2026-08-01", "2026-01-01", "2026-06-10").covered).toBe(0);
  });

  it("handles a term that starts and ends inside one month", () => {
    expect(coveredDays("2026-04-01", "2026-04-10", "2026-04-20")).toEqual({
      covered: 11,
      total: 30,
    });
  });
});

describe("todayInSaoPaulo", () => {
  it("reads the São Paulo calendar day, not the UTC one", () => {
    // 02:30 UTC on the 13th is still 23:30 on the 12th in São Paulo (UTC−3).
    expect(todayInSaoPaulo(new Date("2026-08-13T02:30:00Z"))).toBe("2026-08-12");
    expect(todayInSaoPaulo(new Date("2026-08-13T12:00:00Z"))).toBe("2026-08-13");
  });
});
