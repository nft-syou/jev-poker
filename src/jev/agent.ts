import type { HandCategory } from '../engine/evaluate.js';
import type { PairKind } from '../engine/strength.js';
import type { Agent } from '../agents/types.js';
import { Rng } from '../engine/rng.js';
import type { Action, LegalActions, PlayerView, Street } from '../engine/types.js';
import type { JevAnswers, JevBackend } from './backend.js';
import { compressState } from './compress.js';
import { buildQuestions, legalChoices, SIZING_LABELS, type ActionChoice, type PromptStyle } from './questions.js';
import type { Persona } from './personas.js';

/** Below this, tempering is numerically pointless - take the most likely choice instead. */
const MIN_VARIANCE = 0.05;

/** Postflop bet or raise size as a fraction of the pot after calling, indexed by `sizing.score`. */
const SIZING_FRACTIONS: readonly number[] = [0, 1 / 3, 2 / 3, 1, 1.5, Infinity];

export interface DecisionRecord {
  street: Street;
  choice: ActionChoice;
  action: Action;
  probabilities: Record<ActionChoice, number>;
  sizingScore: number | null;
  bluffIntent: number | null;
  latencyMs: number;
  /** True when a backend request was attempted, whether or not it succeeded. */
  apiCall: boolean;
  error?: string;
  model?: string;
  /** Diagnostics copied from the compressed state (absent on fail-open). */
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
  onDecision?: (record: DecisionRecord) => void;
  /** One shared state/question format (default) or a preflop/postflop pair. */
  promptStyle?: PromptStyle;
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(Math.max(x, min), max);
}

function argmax(choices: readonly ActionChoice[], p: readonly number[]): ActionChoice {
  let best = 0;
  for (let i = 1; i < choices.length; i++) if ((p[i] ?? 0) > (p[best] ?? 0)) best = i;
  return choices[best]!;
}

/**
 * Pick a legal choice from the model's probabilities, softened by the persona's
 * variance: `q_i` proportional to `p_i ** (1 / v)`. A low variance sharpens towards
 * the argmax, `v = 1` samples the reported distribution as-is. Exactly one
 * `rng.next()` is consumed when sampling.
 */
function pickChoice(
  choices: readonly ActionChoice[],
  probabilities: Partial<Record<ActionChoice, number>>,
  variance: number,
  rng: Rng,
): ActionChoice {
  const p = choices.map((c) => Math.max(0, probabilities[c] ?? 0));
  if (variance <= MIN_VARIANCE) return argmax(choices, p);

  const v = clamp(variance, MIN_VARIANCE, 1);
  const q = p.map((x) => x ** (1 / v));
  const total = q.reduce((a, b) => a + b, 0);
  if (!(total > 0) || !Number.isFinite(total)) return argmax(choices, p);

  let r = rng.next() * total;
  for (let i = 0; i < choices.length; i++) {
    r -= q[i]!;
    if (r < 0) return choices[i]!;
  }
  return argmax(choices, p);
}

function checkOrCall(legal: LegalActions): Action {
  return legal.canCheck ? { type: 'check' } : { type: 'call' };
}

/** Preflop open sizes in big blinds, indexed by `sizing.score` (the last step is all-in). */
const PREFLOP_OPEN_BB: readonly number[] = [2, 2.5, 3, 3.5, 4, Infinity];
/** Preflop re-raise sizes as a multiple of the raise being faced, indexed by `sizing.score`. */
const PREFLOP_RERAISE_MULT: readonly number[] = [2, 2.5, 3, 3.5, 4, Infinity];

/** The largest raise-to amount seen preflop so far, or `null` when nobody has raised. */
function preflopRaiseFaced(view: PlayerView): number | null {
  let top: number | null = null;
  for (const h of view.history) {
    if (h.street !== 'preflop') continue;
    if ((h.action.type === 'raise' || h.action.type === 'bet') && (top === null || h.action.amount > top)) top = h.action.amount;
  }
  return top;
}

function betOrRaise(score: number, legal: LegalActions, view: PlayerView): Action {
  const min = legal.minRaiseTo;
  if (min === null) return checkOrCall(legal);

  const step = clamp(Math.round(score), 0, SIZING_LABELS.length - 1);
  const max = legal.maxRaiseTo ?? min;
  let target: number;
  if (view.street === 'preflop') {
    // Preflop sizes are conventionally expressed in big blinds (opens) or as a
    // multiple of the raise faced (re-raises), not as a fraction of the pot.
    const faced = preflopRaiseFaced(view);
    const factor = faced === null ? PREFLOP_OPEN_BB[step] : PREFLOP_RERAISE_MULT[step];
    if (!Number.isFinite(factor)) return { type: 'allin' };
    target = faced === null ? (factor ?? 2) * view.bigBlind : (factor ?? 2) * faced;
  } else {
    const fraction = SIZING_FRACTIONS[step] ?? 0;
    if (!Number.isFinite(fraction)) return { type: 'allin' };
    // A pot-fraction bet is measured against the pot after calling, and a raise-to total adds that
    // to the bet being matched. The minimum raise is only a floor (the clamp below), not a base:
    // adding it would turn a "pot-sized" bet into 2 bb into 3 bb.
    target = fraction === 0 ? min : view.currentBet + fraction * (view.pot + view.toCall);
  }

  const amount = Math.round(clamp(target, min, max));
  if (amount >= max) return { type: 'allin' };
  return { type: legal.canCheck ? 'bet' : 'raise', amount };
}

/** Turn Jev's answers into one legal engine action. */
export function answersToAction(
  answers: JevAnswers,
  legal: LegalActions,
  view: PlayerView,
  variance: number,
  rng: Rng,
): { action: Action; choice: ActionChoice; sizingScore: number | null } {
  const choices = legalChoices(legal);
  if (choices.length === 0) {
    const choice: ActionChoice = legal.canCheck ? 'check_or_call' : 'fold';
    return { action: legal.canCheck ? { type: 'check' } : { type: 'fold' }, choice, sizingScore: null };
  }

  const choice = pickChoice(choices, answers.action.probabilities, variance, rng);

  switch (choice) {
    case 'fold':
      return {
        action: legal.canFold ? { type: 'fold' } : checkOrCall(legal),
        choice,
        sizingScore: null,
      };
    case 'check_or_call':
      return { action: checkOrCall(legal), choice, sizingScore: null };
    case 'bet_or_raise': {
      const score = answers.sizing.score;
      const action = betOrRaise(score, legal, view);
      const raised = action.type === 'bet' || action.type === 'raise' || action.type === 'allin';
      return { action, choice, sizingScore: raised ? score : null };
    }
  }
}

function fullProbabilities(p: Partial<Record<ActionChoice, number>>): Record<ActionChoice, number> {
  return {
    fold: p.fold ?? 0,
    check_or_call: p.check_or_call ?? 0,
    bet_or_raise: p.bet_or_raise ?? 0,
  };
}

/** A CPU player that asks Jev one `systemOne` question set per decision. */
export class JevAgent implements Agent {
  readonly id: `jev:${string}`;
  private readonly persona: Persona;
  private readonly backend: JevBackend;
  private readonly rng: Rng;
  private readonly onDecision: ((record: DecisionRecord) => void) | undefined;
  private readonly promptStyle: PromptStyle;

  constructor(opts: JevAgentOptions) {
    this.persona = opts.persona;
    this.backend = opts.backend;
    this.rng = new Rng(opts.seed);
    this.onDecision = opts.onDecision;
    this.promptStyle = opts.promptStyle ?? 'unified';
    this.id = `jev:${opts.persona.id}`;
  }

  async decide(view: PlayerView, legal: LegalActions): Promise<Action> {
    const apiCall = this.backend.kind === 'typesafe';
    const t0 = performance.now();

    try {
      // Inside the try: building the state can throw too (e.g. a malformed view),
      // and that must fail open rather than stall the table.
      const state = compressState(view, legal, this.persona, this.promptStyle);
      const questions = buildQuestions(legal, { street: view.street, style: this.promptStyle });
      const { answers, model } = await this.backend.systemOne(state, questions);
      const { action, choice, sizingScore } = answersToAction(
        answers,
        legal,
        view,
        this.persona.variance,
        this.rng,
      );
      this.onDecision?.({
        street: view.street,
        choice,
        action,
        probabilities: fullProbabilities(answers.action.probabilities),
        sizingScore,
        bluffIntent: answers.bluff_intent.noul,
        latencyMs: performance.now() - t0,
        apiCall,
        model,
        // Diagnostics: what the model was told about its own hand.
        equityVsRandomPct: state.hand.equityVsRandomPct,
        equityVsRangePct: state.hand.equityVsRangePct,
        ...(state.hand.beatsPctOfHands !== undefined ? { beatsPctOfHands: state.hand.beatsPctOfHands } : {}),
        ...(state.hand.madeHand !== undefined ? { madeHand: state.hand.madeHand } : {}),
        ...(state.hand.pairKind !== undefined ? { pairKind: state.hand.pairKind } : {}),
        myBetWasRaised: state.table.myBetWasRaisedThisStreet,
      });
      return action;
    } catch (err) {
      // Fail open: never stall the table on a backend problem.
      const action: Action = legal.canCheck ? { type: 'check' } : { type: 'fold' };
      this.onDecision?.({
        street: view.street,
        choice: legal.canCheck ? 'check_or_call' : 'fold',
        action,
        probabilities: { fold: 0, check_or_call: 0, bet_or_raise: 0 },
        sizingScore: null,
        bluffIntent: null,
        latencyMs: performance.now() - t0,
        apiCall,
        error: String((err as { message?: unknown } | null | undefined)?.message ?? err),
      });
      return action;
    }
  }
}
