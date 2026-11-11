import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { publicOrigin } from "@/lib/public-origin";

const req = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(url, { headers });

describe("publicOrigin", () => {
  it("atrás do proxy do Render, usa o host público e não localhost:10000", () => {
    const r = req("http://localhost:10000/auth/callback", {
      "x-forwarded-host": "financeirodd.onrender.com",
      "x-forwarded-proto": "https",
    });
    expect(publicOrigin(r)).toBe("https://financeirodd.onrender.com");
  });

  it("com vários proxies, fica com o primeiro valor", () => {
    const r = req("http://localhost:10000/", {
      "x-forwarded-host": "financeirodd.onrender.com, interno",
      "x-forwarded-proto": "https,http",
    });
    expect(publicOrigin(r)).toBe("https://financeirodd.onrender.com");
  });

  it("sem proxy (desenvolvimento), vale a origem da requisição", () => {
    expect(publicOrigin(req("http://localhost:3000/login"))).toBe("http://localhost:3000");
  });
});
