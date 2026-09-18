import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
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
import { type DecisionRecord, decideAction, fallbackAction } from "../jev/decide";
import { type ActionTakenEvent, buildFeatures } from "../jev/features";
import { type Persona, PRESET_PERSONAS, personaPrompt } from "../jev/personas";
import type { Settings, Speed } from "./storage";

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
}

export interface GameController {
  state: GameState;
  humanSeats: SeatId[];
  spectator: boolean;
  legalForHuman: LegalActions | null;
  humanAct: (action: Action) => void;
  togglePause: () => void;
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
  | { type: "gameOver"; error: string | null };

const MAX_LOG = 400;

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
  }
}

interface Run {
  alive: boolean;
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
  });

  const tableRef = useRef<Table | null>(null);
  const rngRef = useRef<Rng>(createRng(options.seed ?? randomSeed()));
  const runRef = useRef<Run>({ alive: false });
  const pausedRef = useRef(false);
  const actionsRef = useRef<ActionTakenEvent[]>([]);
  const pendingRef = useRef<DecisionRecord | null>(null);
  const speedRef = useRef<Speed>(settings.speed);
  speedRef.current = settings.speed;

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

  const loop = useCallback(
    async (run: Run) => {
      const table = tableRef.current;
      if (table === null) return;
      while (run.alive && !pausedRef.current) {
        const hand = table.currentHand;
        if (hand === null || hand.isComplete) {
          if (hand !== null) {
            await sleep(BETWEEN_HANDS_MS[speedRef.current]);
            if (!run.alive || pausedRef.current) return;
          }
          try {
            table.startHand();
          } catch (error) {
            dispatch({
              type: "gameOver",
              error: error instanceof Error ? error.message : String(error),
            });
            return;
          }
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
        dispatch({ type: "thinking", seat });
        const snapshot = hand.snapshot();
        const legal = hand.legalActions(seat);
        const persona =
          personas.find((p) => p.id === tableSeat.personaId) ?? (PRESET_PERSONAS[1] as Persona);
        const record: DecisionRecord =
          backend === null
            ? {
                seat,
                action: fallbackAction(legal),
                jev: null,
                error: "no backend",
                errorKind: "other",
                fallback: true,
                latencyMs: 0,
              }
            : await decideAction({
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
                rng: rngRef.current,
                model: settings.model,
              });
        if (!run.alive) return;
        if (record.errorKind === "auth") {
          pausedRef.current = true;
          dispatch({ type: "paused", paused: true });
          dispatch({ type: "thinking", seat: null });
          onAuthFailed();
          return;
        }
        pendingRef.current = record;
        table.act(seat, record.action);
        dispatch({ type: "thinking", seat: null });
        sync();
        const delay = ACTION_DELAY_MS[speedRef.current];
        if (delay > 0) await sleep(delay);
      }
    },
    [backend, onAuthFailed, personas, settings.model, sync],
  );

  const startLoop = useCallback(() => {
    runRef.current.alive = false;
    const run: Run = { alive: true };
    runRef.current = run;
    void loop(run);
  }, [loop]);

  // Create the table once per mount. Settings changes require leaving the table.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    const table = new Table(toConfig(settings, options.seed ?? randomSeed()));
    tableRef.current = table;
    const off = table.on((event) => {
      if (event.type === "HandStarted") actionsRef.current = [];
      if (event.type === "ActionTaken") actionsRef.current = [...actionsRef.current, event];
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
      runRef.current.alive = false;
      off();
      tableRef.current = null;
    };
  }, []);

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
    if (!next) startLoop();
  }, [startLoop]);

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
  };
}
