import { describe, expect, it } from "vitest";
import {
  createDeck,
  formatCard,
  parseCard,
  parseCards,
  RANKS,
  rankChar,
  sameCard,
} from "./cards.js";

describe("cards", () => {
  it("creates a 52-card deck without duplicates", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(formatCard)).size).toBe(52);
  });

  it("round-trips parse and format", () => {
    for (const text of ["As", "Td", "9c", "2h", "Kh"]) {
      expect(formatCard(parseCard(text))).toBe(text);
    }
    expect(parseCard("as")).toEqual({ rank: 14, suit: "s" });
    expect(parseCard("Td")).toEqual({ rank: 10, suit: "d" });
  });

  it("names ranks with one character, matching formatCard", () => {
    expect(RANKS.map(rankChar).join("")).toBe("23456789TJQKA");
    expect(rankChar(10)).toBe("T");
    expect(rankChar(14)).toBe("A");
    for (const card of createDeck()) expect(formatCard(card).charAt(0)).toBe(rankChar(card.rank));
  });

  it("parses a space-separated list", () => {
    expect(parseCards(" As  Kd ").map(formatCard)).toEqual(["As", "Kd"]);
  });

  it("rejects invalid cards", () => {
    expect(() => parseCard("1s")).toThrow(/invalid card/);
    expect(() => parseCard("Ax")).toThrow(/invalid card/);
    expect(() => parseCard("A")).toThrow(/invalid card/);
  });

  it("compares cards structurally", () => {
    expect(sameCard(parseCard("As"), { rank: 14, suit: "s" })).toBe(true);
    expect(sameCard(parseCard("As"), parseCard("Ad"))).toBe(false);
  });
});
