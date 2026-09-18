import { type Card, formatCard, RANKS, SUITS } from "../engine/cards";
import { evaluateBest, HAND_CATEGORIES, type HandCategory } from "../engine/evaluator";
import type { GameEvent, HandSnapshot, SeatId, Street } from "../engine/types";

export type Position = "BTN" | "SB" | "BB" | "UTG" | "MP" | "CO";
export type PreflopStrength = "premium" | "strong" | "medium" | "weak" | "trash";
export type Draw = "flush_draw" | "open_ended" | "gutshot";
export type ActionTakenEvent = Extract<GameEvent, { type: "ActionTaken" }>;

export type PersonaPrompt = { name: string; description: string };

/** What Jev sees. Plain JSON, amounts in big blinds, no opponent hole cards. */
export type DecisionFeatures = {
  task: string;
  persona: PersonaPrompt;
  importantContext: string[];
  hand: {
    street: Street;
    holeCards: string[];
    board: string[];
    madeHand: HandCategory | null;
    draws: Draw[];
    preflopStrength: PreflopStrength;
  };
  table: {
    position: Position;
    playersInHand: number;
    playersToAct: number;
    potBB: number;
    toCallBB: number;
    potOddsPct: number | null;
    effectiveStackBB: number;
    stacksBB: { seat: SeatId; stackBB: number; isAllIn: boolean; folded: boolean }[];
  };
  history: { street: Street; seat: SeatId; action: string; amountBB: number }[];
};

export const TASK =
  "Decide the next action for the acting player in a No-Limit Texas Hold'em cash game.";

export const IMPORTANT_CONTEXT: readonly string[] = [
  "Play in the style described by `persona`; it is the player's character.",
  "Only legal actions are offered as choices; pick among them.",
  "All chip amounts are in big blinds (BB).",
  "Opponents' hole cards are unknown; judge from the board, betting history and positions.",
  "`madeHand`, `draws` and `preflopStrength` were computed exactly by the game engine.",
  "Folding strong hands to no pressure and calling with nothing are both mistakes.",
];

export function positionOf(seat: SeatId, snapshot: HandSnapshot): Position {
  const seats = snapshot.players.map((p) => p.seat);
  const n = seats.length;
  const buttonIndex = seats.indexOf(snapshot.button);
  if (buttonIndex < 0) throw new Error("button is not seated");
  const order = seats.map((_, i) => seats[(buttonIndex + 1 + i) % n] as SeatId);
  const index = order.indexOf(seat);
  if (index < 0) throw new Error(`seat ${seat} is not in the hand`);
  if (n === 2) return seat === snapshot.button ? "SB" : "BB";
  if (index === 0) return "SB";
  if (index === 1) return "BB";
  if (index === n - 1) return "BTN";
  if (index === n - 2) return "CO";
  if (index === 2) return "UTG";
  return "MP";
}

export function preflopStrength([a, b]: readonly [Card, Card]): PreflopStrength {
  const hi = Math.max(a.rank, b.rank);
  const lo = Math.min(a.rank, b.rank);
  const suited = a.suit === b.suit;
  if (hi === lo) {
    if (hi >= 11) return "premium";
    if (hi >= 9) return "strong";
    if (hi >= 5) return "medium";
    return "weak";
  }
  if (hi === 14) {
    if (lo === 13) return "premium";
    if (lo >= 11) return "strong";
    if (lo === 10) return suited ? "strong" : "medium";
    return suited ? "medium" : "weak";
  }
  if (hi === 13) {
    if (lo === 12) return suited ? "strong" : "medium";
    if (lo >= 10) return suited ? "medium" : "weak";
    return suited && lo === 9 ? "weak" : "trash";
  }
  if (hi === 12) {
    if (lo >= 10) return suited ? "medium" : "weak";
    return suited && lo === 9 ? "weak" : "trash";
  }
  if (hi === 11 && lo === 10) return suited ? "medium" : "weak";
  if (suited && hi - lo <= 2 && lo >= 4) return "weak";
  return "trash";
}

export function detectDraws(hole: readonly Card[], board: readonly Card[]): Draw[] {
  if (board.length < 3 || board.length > 4) return [];
  const all = [...hole, ...board];
  const draws: Draw[] = [];

  for (const suit of SUITS) {
    const total = all.filter((c) => c.suit === suit).length;
    const inHole = hole.filter((c) => c.suit === suit).length;
    if (total === 4 && inHole >= 1) draws.push("flush_draw");
  }

  const made = evaluateBest(all);
  const straightOrBetter =
    HAND_CATEGORIES.indexOf(made.category) >= HAND_CATEGORIES.indexOf("straight");
  if (!straightOrBetter) {
    const present = new Set<number>(all.map((c) => c.rank));
    const outs = RANKS.filter((rank) => !present.has(rank) && hasStraight([...present, rank]));
    if (outs.length >= 2) draws.push("open_ended");
    else if (outs.length === 1) draws.push("gutshot");
  }
  return draws;
}

function hasStraight(ranks: readonly number[]): boolean {
  const set = new Set(ranks);
  if (set.has(14)) set.add(1);
  for (let high = 14; high >= 5; high--) {
    if ([0, 1, 2, 3, 4].every((d) => set.has(high - d))) return true;
  }
  return false;
}

export interface BuildFeaturesInput {
  snapshot: HandSnapshot;
  seat: SeatId;
  actions: readonly ActionTakenEvent[];
  persona: PersonaPrompt;
}

export function buildFeatures(input: BuildFeaturesInput): DecisionFeatures {
  const { snapshot, seat } = input;
  const me = snapshot.players.find((p) => p.seat === seat);
  if (me === undefined) throw new Error(`seat ${seat} is not in the hand`);
  const bb = snapshot.bigBlind;
  const toBB = (chips: number) => Math.round((chips / bb) * 100) / 100;

  const toCall = Math.min(Math.max(0, snapshot.currentBet - me.streetBet), me.stack);
  const potOddsPct = toCall > 0 ? Math.round((toCall / (snapshot.pot + toCall)) * 100) : null;
  const opponents = snapshot.players.filter((p) => p.seat !== seat && !p.folded);
  const biggestOpponent = Math.max(0, ...opponents.map((p) => p.stack + p.streetBet));
  const effective = Math.min(me.stack + me.streetBet, biggestOpponent);

  return {
    task: TASK,
    persona: { name: input.persona.name, description: input.persona.description },
    importantContext: [...IMPORTANT_CONTEXT],
    hand: {
      street: snapshot.street,
      holeCards: me.holeCards.map(formatCard),
      board: snapshot.board.map(formatCard),
      madeHand:
        snapshot.board.length >= 3
          ? evaluateBest([...me.holeCards, ...snapshot.board]).category
          : null,
      draws: detectDraws(me.holeCards, snapshot.board),
      preflopStrength: preflopStrength(me.holeCards),
    },
    table: {
      position: positionOf(seat, snapshot),
      playersInHand: snapshot.players.filter((p) => !p.folded).length,
      playersToAct: snapshot.toAct.filter((s) => s !== seat).length,
      potBB: toBB(snapshot.pot),
      toCallBB: toBB(toCall),
      potOddsPct,
      effectiveStackBB: toBB(effective),
      stacksBB: snapshot.players.map((p) => ({
        seat: p.seat,
        stackBB: toBB(p.stack),
        isAllIn: p.allIn,
        folded: p.folded,
      })),
    },
    history: input.actions.map((event) => ({
      street: event.street,
      seat: event.seat,
      action: describeAction(event, toBB),
      amountBB: toBB(event.amount),
    })),
  };
}

function describeAction(event: ActionTakenEvent, toBB: (chips: number) => number): string {
  const action = event.action;
  if (action.type === "bet" || action.type === "raise") {
    return `${action.type} to ${toBB(action.amount)}${event.allIn ? " (all in)" : ""}`;
  }
  return `${action.type}${event.allIn ? " (all in)" : ""}`;
}
