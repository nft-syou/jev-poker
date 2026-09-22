import type {
  Action,
  GameEvent,
  Hand,
  HandSnapshot,
  LegalActions,
  SeatId,
} from "@jev-poker/engine";
import { type DecisionRecord, sizingToAmount } from "./decide";
import type { ActionTakenEvent, DecisionFeatures } from "./features";
import { legalLabels } from "./questions";

/** Identifies one decision: the same state asked the same way reuses the same answer. */
export type DecisionKey = string;

/** Sizing rubric index for a pot-sized bet or raise; the branch we speculate on. */
const POT_SIZED = 3;
const DEFAULT_LIMIT = 8;
const DEFAULT_MAX_IN_FLIGHT = 6;

/**
 * The features plus the labels that were offered. The raw amounts in `legal` are deliberately
 * left out: for the path the hand actually took they are already pinned down by the features —
 * `history` fixes what everyone has put in, `stacksBB` what everyone has left and `toCallBB`
 * what the seat faces — so two states that agree on those agree on the amounts too. The labels
 * are still part of the key because they say which actions are on offer at all (a seat that
 * cannot raise is asked a different question than one that can).
 */
export function decisionKey(features: DecisionFeatures, legal: LegalActions): DecisionKey {
  return stableStringify({ features, labels: legalLabels(legal) });
}

/**
 * FNV-1a over the key's code units. Used to derive a per-decision rng seed, so the sampling
 * for one decision is the same whether it was speculated on or asked for live.
 */
export function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

/** JSON with object keys sorted, so two equal states always stringify the same way. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Representative actions the acting seat might take, used to branch the speculation:
 * fold, check-or-call, and one pot-sized bet or raise. Only legal ones, deduplicated.
 */
export function representativeActions(
  legal: LegalActions,
  snapshot: HandSnapshot,
  seat: SeatId,
): Action[] {
  const actions: Action[] = [];
  if (legal.canFold) actions.push({ type: "fold" });
  if (legal.canCheck) actions.push({ type: "check" });
  else if (legal.callAmount !== null) actions.push({ type: "call" });
  if (legal.minRaiseTo !== null && legal.maxRaiseTo !== null) {
    const amount = sizingToAmount(POT_SIZED, legal, snapshot, seat);
    actions.push(snapshot.currentBet === 0 ? { type: "bet", amount } : { type: "raise", amount });
  }
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = JSON.stringify(action);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A decision some CPU may be asked for next, if the hand takes the branch that leads here. */
export interface SpeculationTarget {
  seat: SeatId;
  snapshot: HandSnapshot;
  legal: LegalActions;
  /** The hand's actions so far, including the hypothetical ones that reached this state. */
  actions: ActionTakenEvent[];
}

function actionsTaken(events: readonly GameEvent[]): ActionTakenEvent[] {
  return events.filter((event): event is ActionTakenEvent => event.type === "ActionTaken");
}

/**
 * Enumerates the next decisions worth asking about while the acting seat is still thinking.
 * The live hand is cloned, never mutated, and speculation stops at the end of the street:
 * a new street deals new cards, so anything past it would be a guess about the deck.
 */
export function speculationTargets(
  hand: Hand,
  actingSeat: SeatId,
  actions: readonly ActionTakenEvent[],
  isCpu: (seat: SeatId) => boolean,
  limit: number = DEFAULT_LIMIT,
): SpeculationTarget[] {
  const targets: SpeculationTarget[] = [];
  if (hand.isComplete || hand.actingSeat !== actingSeat) return targets;
  const street = hand.street;
  const seen = new Set<string>();

  const collect = (clone: Hand, history: ActionTakenEvent[]): void => {
    if (clone.isComplete || clone.street !== street) return;
    const next = clone.actingSeat;
    if (next === null || !isCpu(next)) return;
    const snapshot = clone.snapshot();
    const key = `${next}|${JSON.stringify(snapshot)}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ seat: next, snapshot, legal: clone.legalActions(next), actions: history });
  };

  const snapshot = hand.snapshot();
  const legal = hand.legalActions(actingSeat);
  for (const action of representativeActions(legal, snapshot, actingSeat)) {
    if (targets.length >= limit) return targets;
    const clone = hand.clone();
    collect(clone, [...actions, ...actionsTaken(clone.act(actingSeat, action))]);
  }

  // Preflop folds run in chains: one player giving up usually hands the turn straight to the
  // next, so the whole chain is worth having ready. Post-flop the fold branch ends the hand.
  if (street !== "preflop") return targets;
  const clone = hand.clone();
  let history = [...actions];
  let seat: SeatId | null = actingSeat;
  while (seat !== null && targets.length < limit) {
    if (!clone.legalActions(seat).canFold) break;
    // Folding the last-but-one player ends the hand, so there is nothing to ask after it.
    if (clone.snapshot().players.filter((p) => !p.folded).length <= 2) break;
    history = [...history, ...actionsTaken(clone.act(seat, { type: "fold" }))];
    if (clone.isComplete || clone.street !== street) break;
    collect(clone, history);
    seat = clone.actingSeat;
  }
  return targets;
}

interface CacheEntry {
  readonly promise: Promise<DecisionRecord>;
  readonly controller: AbortController;
}

export interface DecisionCacheStats {
  started: number;
  hits: number;
  misses: number;
  aborted: number;
}

/**
 * Holds speculative decisions until the hand asks for one. Entries are keyed by the decision
 * itself, so a stale entry is never wrong — it is simply never taken.
 */
export class DecisionCache {
  private maxInFlight: number;
  private readonly entries = new Map<DecisionKey, CacheEntry>();
  /** Entries started and not yet settled, including ones already taken. */
  private readonly running = new Set<CacheEntry>();
  private readonly counts: DecisionCacheStats = { started: 0, hits: 0, misses: 0, aborted: 0 };

  constructor(options: { maxInFlight?: number } = {}) {
    this.maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
  }

  /** Counts for the whole session; `clear` drops entries but keeps counting. */
  get stats(): DecisionCacheStats {
    return { ...this.counts };
  }

  get inFlight(): number {
    return this.running.size;
  }

  /** Changes the in-flight cap; entries already running are unaffected. */
  setMaxInFlight(n: number): void {
    this.maxInFlight = n;
  }

  /** Starts a speculative decision unless it is already cached or the cap is reached. */
  prefetch(key: DecisionKey, start: (signal: AbortSignal) => Promise<DecisionRecord>): void {
    if (this.entries.has(key) || this.running.size >= this.maxInFlight) return;
    const controller = new AbortController();
    const entry: CacheEntry = { promise: start(controller.signal), controller };
    this.entries.set(key, entry);
    this.running.add(entry);
    this.counts.started++;
    const settle = () => {
      this.running.delete(entry);
    };
    void entry.promise.then(settle, settle);
  }

  /** The cached or in-flight answer for this key, removed from the cache. */
  take(key: DecisionKey): Promise<DecisionRecord> | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      this.counts.misses++;
      return undefined;
    }
    this.entries.delete(key);
    this.counts.hits++;
    return entry.promise;
  }

  /** Abandons everything: in-flight requests are aborted and cached answers dropped. */
  clear(): void {
    for (const entry of this.running) {
      entry.controller.abort();
      this.counts.aborted++;
    }
    this.running.clear();
    this.entries.clear();
  }
}
