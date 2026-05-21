import { describe, it, expect, beforeEach } from "vitest";
import { cmpVersion, getWhatsNew, markVersionSeen, getLastSeen } from "../src/ludexChangelog.js";

// localStorage em memoria (ambiente node do vitest nao tem)
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
});

describe("cmpVersion", () => {
  it("compara numericamente, nao lexicograficamente", () => {
    expect(cmpVersion("0.9.10", "0.9.9")).toBe(1); // 10 > 9
    expect(cmpVersion("0.9.9", "0.9.10")).toBe(-1);
    expect(cmpVersion("1.0.0", "0.9.99")).toBe(1);
    expect(cmpVersion("0.9.8", "0.9.8")).toBe(0);
  });
});

describe("getWhatsNew", () => {
  it("instalacao nova (sem lastSeen, nao-returning) nao mostra nada e marca como visto", () => {
    expect(getWhatsNew("0.9.8", false)).toBeNull();
    expect(getLastSeen()).toBe("0.9.8");
  });

  it("usuario returning sem lastSeen recebe um resumo das ultimas versoes", () => {
    const r = getWhatsNew("0.9.8", true);
    expect(r).not.toBeNull();
    expect(r.current).toBe("0.9.8");
    expect(r.entries.length).toBeGreaterThan(0);
    expect(r.entries.length).toBeLessThanOrEqual(4);
  });

  it("apos um update real mostra so as versoes entre lastSeen e a atual", () => {
    markVersionSeen("0.9.6");
    const r = getWhatsNew("0.9.8");
    expect(r).not.toBeNull();
    const versions = r.entries.map((e) => e.version);
    expect(versions).toContain("0.9.7");
    expect(versions).toContain("0.9.8");
    expect(versions).not.toContain("0.9.6"); // ja vista
  });

  it("nao mostra de novo quando ja viu a versao atual", () => {
    markVersionSeen("0.9.8");
    expect(getWhatsNew("0.9.8")).toBeNull();
  });

  it("retorna null sem versao", () => {
    expect(getWhatsNew("")).toBeNull();
    expect(getWhatsNew(null)).toBeNull();
  });
});
