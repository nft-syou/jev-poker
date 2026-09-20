import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { fixedBlinds } from "../engine/blinds";
import type { Hand } from "../engine/hand";
import { createRng, type Rng, randomSeed } from "../engine/rng";
import { Table } from "../engine/table";
import type {
  Action,
  GameConfig,
  GameEvent,
  HandSnapshot,
  LegalActions,
  SeatId,
  SeatKind,
} from "../engine/types";
import type { JevBackend } from "../jev/backend";
import { type DecisionRecord, decideAction } from "../jev/decide";
import { type ActionTakenEvent, buildFeatures, type DecisionFeatures } from "../jev/features";
import { type Persona, PRESET_PERSONAS, personaPrompt } from "../jev/personas";
import {
  DecisionCache,
  type DecisionKey,
  decisionKey,
  fnv1a,
  speculationTargets,
} from "../jev/prefetch";
import { EMPTY_FX, reduceFx, type TableFx } from "./fx";
import {
  addStats,
  EMPTY_STATS,
  HandStatsTracker,
  type PlayerStats,
  type StatsKey,
  statsKeyFor,
} from "./stats";
import {
  clearCumulativeStats,
  loadCumulativeStats,
  type Settings,
  type Speed,
  saveCumulativeStats,
} from "./storage";

export const ACTION_DELAY_MS: Record<Speed, number> = {
  slow: 1600,
  normal: 800,
  fast: 250,
  max: 0,
};
export const BETWEEN_HANDS_MS: Record<Speed, number> = {
  slow: 3000,
  normal: 1800,
  fast: 700,
  max: 0,
};

/** A decision as the UI reports it: Jev's record plus how it reached the table. */
export type DecisionInfo = DecisionRecord & { prefetched: boolean };

export interface LogEntry {
  id: number;
  event: GameEvent;
  decision?: DecisionInfo;
  /** What Jev was shown for `decision`; kept so a panel can describe the hand it judged. */
  features?: DecisionFeatures;
}

/** The decision the table played most recently, for the showcase overlays. */
export interface LastDecision {
  seat: SeatId;
  record: DecisionInfo;
  features: DecisionFeatures;
  /** `Date.now()` when it landed, so an overlay can fade itself out. */
  at: number;
}

/** How the speculative decision cache is doing this sitting. */
export interface PrefetchStats {
  started: number;
  hits: number;
  misses: number;
}

export interface GameSeat {
  id: SeatId;
  name: string;
  kind: SeatKind;
  stack: number;
}

export interface GameState {
  snapshot: HandSnapshot | null;
  seats: GameSeat[];
  log: LogEntry[];
  thinkingSeat: SeatId | null;
  paused: boolean;
  /** Why the table is paused, when it paused itself; null for a manual pause or when running. */
  pauseReason: "auth" | "billing" | null;
  handsPlayed: number;
  gameOver: boolean;
  error: string | null;
  /** Stats for this sitting, by seat. Derived from events, never from the trimmed log. */
  stats: Record<SeatId, PlayerStats>;
  prefetch: PrefetchStats;
  lastDecision: LastDecision | null;
  /** Largest pot awarded this sitting, in chips. */
  maxPot: number;
  /** Everything the felt animates: shouts, chips in flight, winners. Derived from events. */
  fx: TableFx;
}

export interface GameController {
  state: GameState;
  humanSeats: SeatId[];
  spectator: boolean;
  legalForHuman: LegalActions | null;
  humanAct: (action: Action) => void;
  togglePause: () => void;
  /** Stats kept across sittings, by persona or human name. */
  cumulative: Record<StatsKey, PlayerStats>;
  statsKeys: Record<SeatId, StatsKey>;
  resetCumulative: () => void;
}

export interface UseGameOptions {
  settings: Settings;
  personas: readonly Persona[];
  backend: JevBackend | null;
  onAuthFailed: () => void;
  onBillingFailed: () => void;
  seed?: number;
}

type Msg =
  | {
      type: "event";
      event: GameEvent;
      decision?: DecisionInfo;
      features?: DecisionFeatures;
      /** `Date.now()` when the event was seen; stamped by the caller to keep this pure. */
      at?: number;
    }
  | { type: "sync"; snapshot: HandSnapshot | null; seats: GameSeat[]; handsPlayed: number }
  | { type: "thinking"; seat: SeatId | null }
  | { type: "paused"; paused: boolean; reason?: "auth" | "billing" }
  | { type: "gameOver"; error: string | null }
  | { type: "stats"; deltas: ReadonlyMap<SeatId, PlayerStats> }
  | { type: "prefetch"; stats: PrefetchStats }
  | { type: "reset" };

const MAX_LOG = 400;

/** `GameState.error` marker for "there is no API key"; the UI localizes it. */
export const NO_BACKEND_ERROR = "no backend";

function reducer(state: GameState, msg: Msg): GameState {
  switch (msg.type) {
    case "event": {
      const entry: LogEntry = {
        id: state.log.length === 0 ? 1 : (state.log[state.log.length - 1]?.id ?? 0) + 1,
        event: msg.event,
      };
      if (msg.decision !== undefined) entry.decision = msg.decision;
      if (msg.features !== undefined) entry.features = msg.features;
      const log = [...state.log, entry];
      const lastDecision =
        msg.decision !== undefined && msg.features !== undefined
          ? {
              seat: msg.decision.seat,
              record: msg.decision,
              features: msg.features,
              at: msg.at ?? 0,
            }
          : state.lastDecision;
      const awarded =
        msg.event.type === "PotAwarded"
          ? msg.event.awards.reduce((sum, award) => sum + award.amount, 0)
          : 0;
      return {
        ...state,
        log: log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log,
        lastDecision,
        maxPot: Math.max(state.maxPot, awarded),
        // `msg.at` is the listener's clock reading: the effects layer needs timestamps, and
        // this reducer must stay a pure function of what it is handed.
        fx: reduceFx(state.fx, msg.event, msg.at ?? 0),
      };
    }
    case "sync":
      return { ...state, snapshot: msg.snapshot, seats: msg.seats, handsPlayed: msg.handsPlayed };
    case "thinking":
      return { ...state, thinkingSeat: msg.seat };
    case "paused":
      return {
        ...state,
        paused: msg.paused,
        pauseReason: msg.paused ? (msg.reason ?? null) : null,
      };
    case "gameOver":
      return { ...state, gameOver: true, error: msg.error, thinkingSeat: null };
    case "stats": {
      const stats = { ...state.stats };
      for (const [seat, delta] of msg.deltas) {
        stats[seat] = addStats(stats[seat] ?? EMPTY_STATS, delta);
      }
      return { ...state, stats };
    }
    case "prefetch":
      return { ...state, prefetch: msg.stats };
    case "reset":
      return { ...state, gameOver: false, error: null };
  }
}

interface Run {
  alive: boolean;
  /** Aborted together with `alive`, so an in-flight Jev request is dropped at once. */
  abort: AbortController;
}

function stopRun(run: Run): void {
  run.alive = false;
  run.abort.abort();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The persona a seat plays, falling back to the default preset when its id is unknown. */
function personaFor(personas: readonly Persona[], personaId: string | undefined): Persona {
  return personas.find((p) => p.id === personaId) ?? (PRESET_PERSONAS[1] as Persona);
}

function toConfig(settings: Settings, seed: number): GameConfig {
  return {
    format: "cash",
    blinds: fixedBlinds(settings.smallBlind, settings.bigBlind),
    startingStack: settings.startingStack,
    seats: settings.seats.map((seat, id) => ({
      id,
      name: seat.name,
      kind: seat.kind,
      personaId: seat.personaId,
    })),
    seed,
  };
}

export function useGame(options: UseGameOptions): GameController {
  const { settings, personas, backend, onAuthFailed, onBillingFailed } = options;
  const [state, dispatch] = useReducer(reducer, {
    snapshot: null,
    seats: [],
    log: [],
    thinkingSeat: null,
    paused: false,
    pauseReason: null,
    handsPlayed: 0,
    gameOver: false,
    error: null,
    stats: {},
    prefetch: { started: 0, hits: 0, misses: 0 },
    lastDecision: null,
    maxPot: 0,
    fx: EMPTY_FX,
  });
  const [cumulative, setCumulative] = useState<Record<StatsKey, PlayerStats>>(() =>
    loadCumulativeStats(),
  );

  const tableRef = useRef<Table | null>(null);
  /** Seed every decision's sampling derives from; the table keeps its own, separate rng. */
  const decisionSeedRef = useRef<number | null>(null);
  if (decisionSeedRef.current === null) decisionSeedRef.current = options.seed ?? randomSeed();
  const runRef = useRef<Run | null>(null);
  const pausedRef = useRef(false);
  /** Set when the loop stopped itself because Jev rejected the key. */
  const authPausedRef = useRef(false);
  /**
   * Set when the loop stopped itself because TypeSafe returned 402 Payment Required. Mirrors
   * `authPausedRef` for symmetry, but nothing branches on it: unlike an auth pause, a billing
   * pause never auto-resumes, so the UI is driven entirely by `state.pauseReason` instead.
   */
  const billingPausedRef = useRef(false);
  /** Set when the loop gave up because there was no backend to ask. */
  const noBackendRef = useRef(false);
  const actionsRef = useRef<ActionTakenEvent[]>([]);
  const pendingRef = useRef<{ record: DecisionInfo; features: DecisionFeatures } | null>(null);
  const cacheRef = useRef<DecisionCache | null>(null);
  if (cacheRef.current === null) {
    cacheRef.current = new DecisionCache({ maxInFlight: settings.prefetchMaxInFlight });
  }
  const trackerRef = useRef<HandStatsTracker | null>(null);
  if (trackerRef.current === null) trackerRef.current = new HandStatsTracker();
  const speedRef = useRef<Speed>(settings.speed);
  speedRef.current = settings.speed;
  /** Read mid-loop so a live setting change (from `Setup`/`TableView`) applies immediately. */
  const prefetchRef = useRef<boolean>(settings.prefetch);
  prefetchRef.current = settings.prefetch;

  /**
   * One rng per decision, derived from the game seed and the decision itself. A speculative
   * and a live call for the same state therefore sample the same label, so what the table
   * plays no longer depends on whether the answer was prefetched or waited for.
   */
  const rngFor = useCallback((key: DecisionKey): Rng => {
    return createRng(((decisionSeedRef.current ?? 0) ^ fnv1a(key)) >>> 0);
  }, []);

  const statsKeys = useMemo(() => {
    const keys: Record<SeatId, StatsKey> = {};
    settings.seats.forEach((seat, id) => {
      keys[id] = statsKeyFor(seat);
    });
    return keys;
  }, [settings.seats]);
  // The table listener is installed once, but it must always see the current keys.
  const statsKeysRef = useRef(statsKeys);
  statsKeysRef.current = statsKeys;

  const sync = useCallback(() => {
    const table = tableRef.current;
    if (table === null) return;
    dispatch({
      type: "sync",
      snapshot: table.snapshot(),
      seats: table.seats.map((s) => ({ id: s.id, name: s.name, kind: s.kind, stack: s.stack })),
      handsPlayed: table.handNumber,
    });
  }, []);

  /** Closes a hand's stats: session deltas, then one read-modify-write of the store. */
  const finishStats = useCallback(() => {
    const deltas = trackerRef.current?.flush();
    if (deltas === undefined || deltas.size === 0) return;
    dispatch({ type: "stats", deltas });
    const keys = statsKeysRef.current;
    // Re-read rather than trusting the React copy: another tab may have played too.
    const next = loadCumulativeStats();
    for (const [seat, delta] of deltas) {
      const key = keys[seat];
      if (key === undefined) continue;
      next[key] = addStats(next[key] ?? EMPTY_STATS, delta);
    }
    saveCumulativeStats(next);
    setCumulative(next);
  }, []);

  const resetCumulative = useCallback(() => {
    clearCumulativeStats();
    setCumulative({});
  }, []);

  const reportPrefetch = useCallback(() => {
    const cache = cacheRef.current;
    if (cache === null) return;
    const { started, hits, misses } = cache.stats;
    dispatch({ type: "prefetch", stats: { started, hits, misses } });
  }, []);

  /**
   * Asks Jev, in the background, about the decisions that may follow `seat`'s turn. It runs
   * while that seat is still being decided (or while a human is still thinking), so the answer
   * is usually already in hand when the turn arrives.
   */
  const speculate = useCallback(
    (hand: Hand, seat: SeatId) => {
      if (!prefetchRef.current) return;
      const table = tableRef.current;
      const cache = cacheRef.current;
      if (table === null || cache === null || backend === null) return;
      const isCpu = (id: SeatId) => table.seats.find((s) => s.id === id)?.kind === "cpu";
      for (const target of speculationTargets(hand, seat, actionsRef.current, isCpu)) {
        const tableSeat = table.seats.find((s) => s.id === target.seat);
        if (tableSeat === undefined) continue;
        const persona = personaFor(personas, tableSeat.personaId);
        const features = buildFeatures({
          snapshot: target.snapshot,
          seat: target.seat,
          actions: target.actions,
          persona: personaPrompt(persona),
        });
        const key = decisionKey(features, target.legal);
        cache.prefetch(key, (signal) =>
          decideAction({
            backend,
            seat: target.seat,
            features,
            legal: target.legal,
            snapshot: target.snapshot,
            variance: persona.variance,
            rng: rngFor(key),
            model: settings.model,
            signal,
          }),
        );
      }
      reportPrefetch();
    },
    [backend, personas, reportPrefetch, rngFor, settings.model],
  );

  const loop = useCallback(
    async (run: Run) => {
      const table = tableRef.current;
      const cache = cacheRef.current;
      if (table === null || cache === null) return;
      // The whole body is guarded: a throw from the engine or the feature builder must surface
      // as `gameOver` instead of an unhandled rejection from `void loop(run)`.
      try {
        while (run.alive && !pausedRef.current) {
          const hand = table.currentHand;
          if (hand === null || hand.isComplete) {
            if (hand !== null) {
              await sleep(BETWEEN_HANDS_MS[speedRef.current]);
              if (!run.alive || pausedRef.current) return;
            }
            table.startHand();
            sync();
            continue;
          }
          const seat = hand.actingSeat;
          if (seat === null) return;
          const tableSeat = table.seats.find((s) => s.id === seat);
          if (tableSeat === undefined || tableSeat.kind === "human") {
            // A human takes their time; spend it on the CPU answers to what they might do.
            if (tableSeat !== undefined) speculate(hand, seat);
            sync();
            return; // resumed by humanAct
          }
          if (backend === null) {
            // No API key means no Jev, and CPUs must not play on a fallback forever.
            noBackendRef.current = true;
            dispatch({ type: "gameOver", error: NO_BACKEND_ERROR });
            return;
          }
          dispatch({ type: "thinking", seat });
          const snapshot = hand.snapshot();
          const legal = hand.legalActions(seat);
          const persona = personaFor(personas, tableSeat.personaId);
          const features = buildFeatures({
            snapshot,
            seat,
            actions: actionsRef.current,
            persona: personaPrompt(persona),
          });
          const key = decisionKey(features, legal);
          const speculated = cache.take(key);
          // Branch out before blocking: the next decisions are asked for while this one lands.
          speculate(hand, seat);
          const record: DecisionInfo =
            speculated === undefined
              ? {
                  ...(await decideAction({
                    backend,
                    seat,
                    features,
                    legal,
                    snapshot,
                    variance: persona.variance,
                    rng: rngFor(key),
                    model: settings.model,
                    signal: run.abort.signal,
                  })),
                  prefetched: false,
                }
              : { ...(await speculated), prefetched: true };
          // A stale or paused run may still receive the (aborted) record; never act on it.
          if (!run.alive || pausedRef.current) return;
          if (record.errorKind === "auth" || record.errorKind === "billing") {
            pausedRef.current = true;
            if (record.errorKind === "auth") authPausedRef.current = true;
            else billingPausedRef.current = true;
            stopRun(run);
            cache.clear();
            dispatch({ type: "paused", paused: true, reason: record.errorKind });
            dispatch({ type: "thinking", seat: null });
            if (record.errorKind === "auth") onAuthFailed();
            else onBillingFailed();
            return;
          }
          pendingRef.current = { record, features };
          trackerRef.current?.onDecision(record, record.prefetched);
          table.act(seat, record.action);
          dispatch({ type: "thinking", seat: null });
          reportPrefetch();
          sync();
          const delay = ACTION_DELAY_MS[speedRef.current];
          if (delay > 0) await sleep(delay);
        }
      } catch (error) {
        if (run.alive) {
          dispatch({
            type: "gameOver",
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
    },
    [
      backend,
      onAuthFailed,
      onBillingFailed,
      personas,
      reportPrefetch,
      rngFor,
      settings.model,
      speculate,
      sync,
    ],
  );

  const stopCurrentRun = useCallback(() => {
    const run = runRef.current;
    if (run !== null) stopRun(run);
  }, []);

  /**
   * Starts the game loop. The speculation is dropped with the old run unless the caller kept
   * playing the same turn — `humanAct` restarts the loop precisely to use what it prefetched.
   */
  const startLoop = useCallback(
    (options: { keepSpeculation?: boolean } = {}) => {
      stopCurrentRun();
      if (options.keepSpeculation !== true) cacheRef.current?.clear();
      const run: Run = { alive: true, abort: new AbortController() };
      runRef.current = run;
      void loop(run);
    },
    [loop, stopCurrentRun],
  );

  // Create the table once per mount. Settings changes require leaving the table.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    const table = new Table(toConfig(settings, options.seed ?? randomSeed()));
    tableRef.current = table;
    const off = table.on((event) => {
      if (event.type === "HandStarted") {
        actionsRef.current = [];
        // New cards: nothing speculated about the last hand can apply to this one.
        cacheRef.current?.clear();
      }
      if (event.type === "ActionTaken") actionsRef.current = [...actionsRef.current, event];
      trackerRef.current?.onEvent(event);
      if (event.type === "HandEnded") finishStats();
      const pending = pendingRef.current;
      const matched =
        pending !== null && event.type === "ActionTaken" && event.seat === pending.record.seat
          ? pending
          : null;
      if (matched !== null) pendingRef.current = null;
      // Every event is stamped here, not in the reducer: the effects layer runs on time and
      // the reducer has to stay pure.
      const at = Date.now();
      dispatch(
        matched === null
          ? { type: "event", event, at }
          : {
              type: "event",
              event,
              decision: matched.record,
              features: matched.features,
              at,
            },
      );
    });
    sync();
    startLoop();
    return () => {
      stopCurrentRun();
      cacheRef.current?.clear();
      off();
      tableRef.current = null;
    };
  }, []);

  // A fresh backend (the user fixed the API key) revives a table that stopped for want of a
  // working one. React only re-runs this when the backend identity changes, and both guards
  // are refs that are false until the loop itself trips them, so the initial mount — and any
  // later backend swap on a healthy table — starts nothing extra.
  // biome-ignore lint/correctness/useExhaustiveDependencies: must fire on a new backend only
  useEffect(() => {
    if (backend === null) return;
    if (authPausedRef.current) {
      authPausedRef.current = false;
      noBackendRef.current = false;
      pausedRef.current = false;
      dispatch({ type: "paused", paused: false });
      startLoop();
      return;
    }
    if (noBackendRef.current) {
      noBackendRef.current = false;
      dispatch({ type: "reset" });
      startLoop();
    }
  }, [backend]);

  // Turning prefetch off mid-game drops whatever was already speculated; turning it back on
  // starts clean rather than resurrecting stale entries, so nothing special happens there.
  const wasPrefetchingRef = useRef(settings.prefetch);
  useEffect(() => {
    if (wasPrefetchingRef.current && !settings.prefetch) {
      cacheRef.current?.clear();
      reportPrefetch();
    }
    wasPrefetchingRef.current = settings.prefetch;
  }, [settings.prefetch, reportPrefetch]);

  // The cache is created once; a later change to the configured cap is applied in place so
  // cumulative stats survive it.
  useEffect(() => {
    cacheRef.current?.setMaxInFlight(settings.prefetchMaxInFlight);
  }, [settings.prefetchMaxInFlight]);

  const humanAct = useCallback(
    (action: Action) => {
      const table = tableRef.current;
      const hand = table?.currentHand;
      if (table === null || hand === null || hand === undefined || hand.isComplete) return;
      const seat = hand.actingSeat;
      if (seat === null) return;
      const tableSeat = table.seats.find((s) => s.id === seat);
      if (tableSeat?.kind !== "human") return;
      try {
        table.act(seat, action);
      } catch {
        return; // illegal action from the UI; ignore and keep waiting
      }
      sync();
      // The CPU answers to this very action were prefetched while the human was thinking.
      startLoop({ keepSpeculation: true });
    },
    [startLoop, sync],
  );

  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    dispatch({ type: "paused", paused: next });
    if (next) {
      stopCurrentRun();
      cacheRef.current?.clear();
      reportPrefetch();
    } else {
      // A manual resume clears whatever self-pause was in effect (billing never clears
      // itself, and an auth pause resumed this way needn't wait for a fresh backend too).
      authPausedRef.current = false;
      billingPausedRef.current = false;
      startLoop();
    }
  }, [reportPrefetch, startLoop, stopCurrentRun]);

  const humanSeats = useMemo(
    () => settings.seats.flatMap((s, id) => (s.kind === "human" ? [id] : [])),
    [settings.seats],
  );

  const legalForHuman = useMemo(() => {
    const table = tableRef.current;
    const snapshot = state.snapshot;
    if (table === null || snapshot === null || snapshot.complete || snapshot.actingSeat === null)
      return null;
    if (!humanSeats.includes(snapshot.actingSeat)) return null;
    return table.legalActions(snapshot.actingSeat);
  }, [humanSeats, state.snapshot]);

  return {
    state,
    humanSeats,
    spectator: humanSeats.length === 0,
    legalForHuman,
    humanAct,
    togglePause,
    cumulative,
    statsKeys,
    resetCumulative,
  };
}
