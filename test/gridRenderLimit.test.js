import { describe, it, expect } from "vitest";
import { gridRenderLimit } from "../src/ludexUtils.js";

describe("gridRenderLimit (render progressivo do grid)", () => {
  it("usa o limite atual quando o selecionado está bem dentro dele", () => {
    expect(gridRenderLimit(120, 0)).toBe(120);
    expect(gridRenderLimit(120, 50)).toBe(120); // 50+30=80 < 120
  });

  it("INVARIANTE: o card selecionado está SEMPRE dentro do slice renderizado", () => {
    // pra qualquer índice selecionado, selectedIdx < gridRenderLimit (com buffer>0)
    for (const renderLimit of [120, 240, 1]) {
      for (const sel of [0, 1, 119, 120, 500, 4999]) {
        expect(sel).toBeLessThan(gridRenderLimit(renderLimit, sel));
      }
    }
  });

  it("expande pra cobrir um pulo (Surpresa!/busca) além do limite atual", () => {
    expect(gridRenderLimit(120, 2000)).toBe(2030); // 2000+30
    expect(gridRenderLimit(120, 119)).toBe(149);   // 119+30 > 120
  });

  it("buffer customizável", () => {
    expect(gridRenderLimit(0, 10, 5)).toBe(15);
  });

  it("trata índices inválidos/negativos sem quebrar", () => {
    expect(gridRenderLimit(120, -1)).toBe(120);
    expect(gridRenderLimit(120, NaN)).toBe(120);
    expect(gridRenderLimit(120, undefined)).toBe(120);
  });
});
