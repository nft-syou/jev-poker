import {
  type Action,
  createRng,
  type HandCategory,
  type LegalActions,
  type PairKind,
  type PlayerView,
  type Rng,
  type Street,
} from "@jev-poker/engine";
import type { JevBackend } from "../jev/backend";
import { decideAction, fallbackAction, type SizingSnapshot } from "../jev/decide";
import {
  type DecisionFeatures,
  type FeatureOptions,
  featuresFromView,
  type OpponentStats,
} from "../jev/features";
import { type Persona, personaPrompt } from "../jev/personas";
import type { ActionLabel, PromptStyle } from "../jev/questions";
import { chartPreflop } from "./heuristic";
import type { Agent } from "./types";

/** One decision of a `JevAgent`, flat and JSON-friendly so a benchmark can store it. */
export interface AgentDecision {
  street: Street;
  choice: ActionLabel;
  action: Action;
  probabilities: Record<ActionLabel, number>;
  sizingScore: number | null;
  bluffIntent: number | null;
  latencyMs: number;
  /** True when a backend request was attempted, whether or not it succeeded. */
  apiCall: boolean;
  error?: string;
  model?: string;
  /** Diagnostics copied from the features (absent when the decision fell back). */
  equityVsRandomPct?: number;
  equityVsRangePct?: number;
  beatsPctOfHands?: number;
  madeHand?: HandCategory;
  pairKind?: PairKind;
  myBetWasRaised?: boolean;
}

export interface JevAgentOptions {
  persona: Persona;
  backend: JevBackend;
  seed: number;
  model?: string;
  onDecision?: (record: AgentDecision) => void;
  /** One shared state/question format (default) or a preflop/postflop pair. */
  promptStyle?: PromptStyle;
  /** `chart`: preflop decisions come from the position-based chart in code; Jev decides postflop only. */
  preflop?: "jev" | "chart";
  /** Add the range-aware equity feature to the state (off by default, see `FeatureOptions`). */
  rangeEquity?: boolean;
  /** Session statistics lookup for opponents (adds `table.opponentStats`). */
  opponentStatsFor?: (seat: number) => OpponentStats | null;
}

function labelOf(action: Action): ActionLabel {
  if (action.type === "fold") return "fold";
  return action.type === "check" || action.type === "call" ? "check_or_call" : "bet_or_raise";
}

function sizingSnapshot(view: PlayerView): SizingSnapshot {
  return {
    street: view.street,
    currentBet: view.currentBet,
    pot: view.pot,
    bigBlind: view.bigBlind,
    players: [{ seat: view.seat, streetBet: view.committedThisStreet }],
  };
}

/**
 * The game's Jev CPU behind the `Agent` interface: the same `featuresFromView` and
 * `decideAction` the table uses, so a benchmark of this agent measures the shipped player.
 */
export class JevAgent implements Agent {
  readonly id: `jev:${string}`;
  private readonly rng: Rng;
  private readonly featureOptions: FeatureOptions;

  constructor(private readonly options: JevAgentOptions) {
    this.id = `jev:${options.persona.id}`;
    this.rng = createRng(options.seed);
    this.featureOptions = {
      ...(options.promptStyle === undefined ? {} : { style: options.promptStyle }),
      ...(options.rangeEquity === undefined ? {} : { rangeEquity: options.rangeEquity }),
      ...(options.opponentStatsFor === undefined
        ? {}
        : { opponentStatsFor: options.opponentStatsFor }),
    };
  }

  async decide(view: PlayerView, legal: LegalActions): Promise<Action> {
    const { persona, backend, onDecision } = this.options;
    const started = performance.now();
    let features: DecisionFeatures;
    try {
      features = featuresFromView(view, personaPrompt(persona), this.featureOptions);
    } catch (error) {
      // Building the state can throw too (a malformed view); fail open rather than stall the table.
      const action = fallbackAction(legal);
      onDecision?.({
        street: view.street,
        choice: labelOf(action),
        action,
        probabilities: { fold: 0, check_or_call: 0, bet_or_raise: 0 },
        sizingScore: null,
        bluffIntent: null,
        latencyMs: performance.now() - started,
        apiCall: false,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      return action;
    }
    const diagnostics = {
      equityVsRandomPct: features.hand.equityVsRandomPct,
      ...(features.hand.equityVsRangePct === undefined
        ? {}
        : { equityVsRangePct: features.hand.equityVsRangePct }),
      ...(features.hand.beatsPctOfHands === undefined
        ? {}
        : { beatsPctOfHands: features.hand.beatsPctOfHands }),
      ...(features.hand.madeHand === undefined ? {} : { madeHand: features.hand.madeHand }),
      ...(features.hand.pairKind === undefined ? {} : { pairKind: features.hand.pairKind }),
      myBetWasRaised: features.table.myBetWasRaisedThisStreet,
    };

    if (this.options.preflop === "chart" && view.street === "preflop") {
      const action = chartPreflop(features, view, legal);
      const choice = labelOf(action);
      onDecision?.({
        street: view.street,
        choice,
        action,
        probabilities: { fold: 0, check_or_call: 0, bet_or_raise: 0, [choice]: 1 },
        sizingScore: null,
        bluffIntent: null,
        latencyMs: performance.now() - started,
        apiCall: false,
        model: "chart",
        ...diagnostics,
      });
      return action;
    }

    const record = await decideAction({
      backend,
      seat: view.seat,
      features,
      legal,
      snapshot: sizingSnapshot(view),
      variance: persona.variance,
      rng: this.rng,
      ...(this.options.promptStyle === undefined ? {} : { promptStyle: this.options.promptStyle }),
      ...(this.options.model === undefined ? {} : { model: this.options.model }),
    });
    const choice = record.jev?.chosen ?? labelOf(record.action);
    onDecision?.({
      street: view.street,
      choice,
      action: record.action,
      probabilities: { fold: 0, check_or_call: 0, bet_or_raise: 0, ...record.jev?.probabilities },
      sizingScore: record.jev !== null && choice === "bet_or_raise" ? record.jev.sizingScore : null,
      bluffIntent: record.jev?.bluffIntent ?? null,
      latencyMs: record.latencyMs,
      apiCall: backend.kind === "typesafe",
      ...(record.error === null ? {} : { error: record.error }),
      ...(record.jev === null ? {} : { model: record.jev.model }),
      ...(record.fallback ? {} : diagnostics),
    });
    return record.action;
  }
}
