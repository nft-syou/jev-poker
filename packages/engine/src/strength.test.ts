import { describe, expect, it } from "vitest";
import { parseCards } from "./cards.js";
import { detectDraws, madeHand, pairKind, preflopStrength } from "./strength.js";

describe("preflopStrength", () => {
  it.each([
    ["Ah Ad", "premium"],
    ["Ah Kh", "premium"],
    ["Ah Kd", "premium"],
    ["Th Td", "strong"],
    ["Ah Qd", "strong"],
    ["Kh Qh", "strong"],
    ["8h 8d", "medium"],
    ["Ah 5h", "medium"],
    ["Ah Jd", "medium"],
    ["2h 2d", "weak"],
    ["9h 8h", "weak"],
    ["Ah 2d", "weak"],
    ["7h 2d", "trash"],
    ["Kh 3d", "trash"],
  ])("%s → %s", (h, t) => expect(preflopStrength(parseCards(h))).toBe(t));

  it("does not depend on the order of the hole cards", () => {
    expect(preflopStrength(parseCards("Kd Ah"))).toBe("premium");
    expect(preflopStrength(parseCards("8h 9h"))).toBe("weak");
  });

  it("needs two hole cards", () => {
    expect(() => preflopStrength(parseCards("Ah"))).toThrow();
  });
});

describe("madeHand", () => {
  it("uses hole + board", () =>
    expect(madeHand(parseCards("Ah Ad"), parseCards("Ac 7s 2d"))).toBe("three_of_a_kind"));
});

describe("detectDraws", () => {
  const draws = (hole: string, board: string) => detectDraws(parseCards(hole), parseCards(board));

  it("flush draw", () => expect(draws("Ah 9h", "Kh 2h 7c")).toContain("flush_draw"));
  it("open ended", () => expect(draws("9h 8d", "Tc 7s 2d")).toContain("open_ended"));
  it("gutshot", () => expect(draws("9h 8d", "Tc 6s 2d")).toContain("gutshot"));
  it("none on river", () => expect(draws("Ah 9h", "Kh 2h 7c 3d 4s")).toEqual([]));
  it("none before the flop", () => expect(draws("Ah 9h", "")).toEqual([]));
  it("no draw when already made", () => expect(draws("Ah 9h", "Kh 2h 7h")).toEqual([]));

  it("lists the flush draw before the straight draw", () => {
    expect(draws("9h 8h", "Th 7c 2h")).toEqual(["flush_draw", "open_ended"]);
    expect(draws("9h 8h", "Th 6c 2h")).toEqual(["flush_draw", "gutshot"]);
  });

  it("a flush draw needs a hole card of the suit", () => {
    // Four hearts on the board: everybody has that draw, so it is not the hero's.
    expect(draws("As Kd", "Qh 9h 5h 2h")).toEqual([]);
    // One hole card of the suit is enough.
    expect(draws("Ah Kd", "Qh 9h 5h 2c")).toEqual(["flush_draw"]);
  });

  it("does not count straight outs the board has on its own", () => {
    // T-9-8-7 on the board: a jack or a six completes it for everybody.
    expect(draws("Ah 2d", "Tc 9d 8s 7h")).toEqual([]);
    // A hole card that fills the run makes the outs the hero's own.
    expect(draws("9h 2d", "Tc 8d 7s 3h")).toEqual(["open_ended"]);
  });

  it("counts the wheel and the broadway ends as one-sided draws", () => {
    expect(draws("Ah 2d", "3c 4s Kd")).toEqual(["gutshot"]);
    expect(draws("Ah Kd", "Qc Js 2d")).toEqual(["gutshot"]);
  });

  it("counts a double gutshot as open ended (two ranks complete it)", () => {
    expect(draws("9h 7d", "Jc 8s 5d")).toEqual(["open_ended"]);
  });
});

describe("pairKind", () => {
  const pk = (h: string, b: string) => pairKind(parseCards(h), parseCards(b));
  it("classifies pairs against the board", () => {
    expect(pk("Ah Ad", "Kc 7s 2d")).toBe("overpair");
    expect(pk("9h 9d", "Kc 7s 2d")).toBe("underpair");
    expect(pk("Kh 5d", "Kc 7s 2d")).toBe("top_pair");
    expect(pk("7h 5d", "Kc 7s 2d")).toBe("middle_pair");
    expect(pk("2h 5d", "Kc 7s 2d")).toBe("bottom_pair");
    expect(pk("Ah 5d", "Kc 7s 7d")).toBe("board_pair");
  });
  it("is null without exactly one pair or before the flop", () => {
    expect(pk("Ah Kd", "Kc 7s 2d Ks")).toBeNull();
    expect(pk("Ah 5d", "Kc 7s 2d")).toBeNull();
    expect(pk("Ah Ad", "")).toBeNull();
  });
});
