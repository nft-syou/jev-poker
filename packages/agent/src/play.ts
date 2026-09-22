import {
  type ActionTakenEvent,
  type GameEvent,
  type HandSnapshot,
  playerView,
  type Table,
} from "@jev-poker/engine";
import type { Agent } from "./agents/types.js";

export interface PlayHandOptions {
  /** Aborting rejects before the next decision; the hand on the table is left where it was. */
  signal?: AbortSignal;
  /** Every event the table emits during the hand, in order. */
  onEvent?: (event: GameEvent) => void;
}

function abortError(): Error {
  return new DOMException("playHand aborted", "AbortError");
}

/**
 * Starts a hand on `table` and asks `agents[seat]` for every decision until it is complete.
 * The agents see the hand exactly as the game's own CPUs do: a `PlayerView` built from the
 * snapshot and the actions taken so far.
 */
export async function playHand(
  table: Table,
  agents: ReadonlyArray<Agent>,
  options: PlayHandOptions = {},
): Promise<HandSnapshot> {
  const taken: ActionTakenEvent[] = [];
  const unsubscribe = table.on((event: GameEvent) => {
    if (event.type === "ActionTaken") taken.push(event);
    options.onEvent?.(event);
  });
  try {
    let snapshot = table.startHand();
    while (!snapshot.complete) {
      if (options.signal?.aborted) throw abortError();
      const seat = snapshot.actingSeat;
      if (seat === null) throw new Error("hand is not over but no seat is to act");
      const agent = agents[seat];
      if (agent === undefined) throw new Error(`no agent for seat ${seat}`);
      const action = await race(
        agent.decide(playerView(snapshot, seat, taken), table.legalActions(seat)),
        options.signal,
      );
      table.act(seat, action);
      const next = table.snapshot();
      if (next === null) throw new Error("the table lost its hand");
      snapshot = next;
    }
    return snapshot;
  } finally {
    unsubscribe();
  }
}

/** Resolves with the decision, or rejects as soon as the signal fires. */
function race<T>(decision: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return decision;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    decision.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
