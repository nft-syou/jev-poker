import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { fixedBlinds } from "../engine/blinds";
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
import { type ActionTakenEvent, buildFeatures } from "../jev/features";
import { type Persona, PRESET_PERSONAS, personaPrompt } from "../jev/personas";
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

export interface LogEntry {
  id: number;
  event: GameEvent;
  decision?: DecisionRecord;
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
  handsPlayed: number;
  gameOver: boolean;
  error: string | null;
  /** Stats for this sitting, by seat. Derived from events, never from the trimmed log. */
  stats: Record<SeatId, PlayerStats>;
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
  seed?: number;
}

type Msg =
  | { type: "event"; event: GameEvent; decision?: DecisionRecord }
  | { type: "sync"; snapshot: HandSnapshot | null; seats: GameSeat[]; handsPlayed: number }
  | { type: "thinking"; seat: SeatId | null }
  | { type: "paused"; paused: boolean }
  | { type: "gameOver"; error: string | null }
  | { type: "stats"; deltas: ReadonlyMap<SeatId, PlayerStats> }
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
      const log = [...state.log, entry];
      return { ...state, log: log.length > MAX_LOG ? log.slice(log.length - MAX_LOG) : log };
    }
    case "sync":
      return { ...state, snapshot: msg.snapshot, seats: msg.seats, handsPlayed: msg.handsPlayed };
    case "thinking":
      return { ...state, thinkingSeat: msg.seat };
    case "paused":
      return { ...state, paused: msg.paused };
    case "gameOver":
      return { ...state, gameOver: true, error: msg.error, thinkingSeat: null };
    case "stats": {
      const stats = { ...state.stats };
      for (const [seat, delta] of msg.deltas) {
        stats[seat] = addStats(stats[seat] ?? EMPTY_STATS, delta);
      }
      return { ...state, stats };
    }
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
  const { settings, personas, backend, onAuthFailed } = options;
  const [state, dispatch] = useReducer(reducer, {
    snapshot: null,
    seats: [],
    log: [],
    thinkingSeat: null,
    paused: false,
    handsPlayed: 0,
    gameOver: false,
    error: null,
    stats: {},
  });
  const [cumulative, setCumulative] = useState<Record<StatsKey, PlayerStats>>(() =>
    loadCumulativeStats(),
  );

  const tableRef = useRef<Table | null>(null);
  const rngRef = useRef<Rng | null>(null);
  if (rngRef.current === null) rngRef.current = createRng(options.seed ?? randomSeed());
  const runRef = useRef<Run | null>(null);
  const pausedRef = useRef(false);
  /** Set when the loop stopped itself because Jev rejected the key. */
  const authPausedRef = useRef(false);
  /** Set when the loop gave up because there was no backend to ask. */
  const noBackendRef = useRef(false);
  const actionsRef = useRef<ActionTakenEvent[]>([]);
  const pendingRef = useRef<DecisionRecord | null>(null);
  const trackerRef = useRef<HandStatsTracker | null>(null);
  if (trackerRef.current === null) trackerRef.current = new HandStatsTracker();
  const speedRef = useRef<Speed>(settings.speed);
  speedRef.current = settings.speed;

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

  const loop = useCallback(
    async (run: Run) => {
      const table = tableRef.current;
      const rng = rngRef.current;
      if (table === null || rng === null) return;
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
          const persona =
            personas.find((p) => p.id === tableSeat.personaId) ?? (PRESET_PERSONAS[1] as Persona);
          const record: DecisionRecord = await decideAction({
            backend,
            seat,
            features: buildFeatures({
              snapshot,
              seat,
              actions: actionsRef.current,
              persona: personaPrompt(persona),
            }),
            legal,
            snapshot,
            variance: persona.variance,
            rng,
            model: settings.model,
            signal: run.abort.signal,
          });
          // A stale or paused run may still receive the (aborted) record; never act on it.
          if (!run.alive || pausedRef.current) return;
          if (record.errorKind === "auth") {
            pausedRef.current = true;
            authPausedRef.current = true;
            stopRun(run);
            dispatch({ type: "paused", paused: true });
            dispatch({ type: "thinking", seat: null });
            onAuthFailed();
            return;
          }
          pendingRef.current = record;
          trackerRef.current?.onDecision(record);
          table.act(seat, record.action);
          dispatch({ type: "thinking", seat: null });
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
    [backend, onAuthFailed, personas, settings.model, sync],
  );

  const stopCurrentRun = useCallback(() => {
    const run = runRef.current;
    if (run !== null) stopRun(run);
  }, []);

  const startLoop = useCallback(() => {
    stopCurrentRun();
    const run: Run = { alive: true, abort: new AbortController() };
    runRef.current = run;
    void loop(run);
  }, [loop, stopCurrentRun]);

  // Create the table once per mount. Settings changes require leaving the table.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    const table = new Table(toConfig(settings, options.seed ?? randomSeed()));
    tableRef.current = table;
    const off = table.on((event) => {
      if (event.type === "HandStarted") actionsRef.current = [];
      if (event.type === "ActionTaken") actionsRef.current = [...actionsRef.current, event];
      trackerRef.current?.onEvent(event);
      if (event.type === "HandEnded") finishStats();
      let decision: DecisionRecord | undefined;
      const pending = pendingRef.current;
      if (pending !== null && event.type === "ActionTaken" && event.seat === pending.seat) {
        decision = pending;
        pendingRef.current = null;
      }
      dispatch(
        decision === undefined ? { type: "event", event } : { type: "event", event, decision },
      );
    });
    sync();
    startLoop();
    return () => {
      stopCurrentRun();
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
      startLoop();
    },
    [startLoop, sync],
  );

  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    dispatch({ type: "paused", paused: next });
    if (next) stopCurrentRun();
    else startLoop();
  }, [startLoop, stopCurrentRun]);

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
