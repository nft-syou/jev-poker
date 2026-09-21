import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import type { JevBackend } from "./backend";
import type { DecisionFeatures } from "./features";

const STRENGTH: Record<string, number> = {
  premium: 0.9,
  strong: 0.7,
  medium: 0.5,
  weak: 0.3,
  trash: 0.15,
  high_card: 0.1,
  pair: 0.4,
  two_pair: 0.65,
  three_of_a_kind: 0.8,
  straight: 0.85,
  flush: 0.9,
  full_house: 0.95,
  four_of_a_kind: 1,
  straight_flush: 1,
};

/** Deterministic stand-in for Jev: strength of the hand drives the answers. Tests only. */
export function createMockBackend(): JevBackend {
  return {
    kind: "mock",
    async systemOne<const Q extends Questions>(request: SystemOneRequest<Q>) {
      const features = request.state as unknown as Partial<DecisionFeatures>;
      const made = features.hand?.madeHand ?? null;
      const key = made ?? features.hand?.preflopStrength ?? "medium";
      const strength = STRENGTH[key] ?? 0.5;
      const answers: Record<string, unknown> = {};
      for (const [name, question] of Object.entries(request.questions)) {
        if (question.type === "choice") {
          const weights: Record<string, number> = {
            fold: 1 - strength,
            check_or_call: 0.6,
            bet_or_raise: strength,
          };
          const labels = Object.keys(question.criteria);
          const total = labels.reduce((sum, label) => sum + (weights[label] ?? 0.1), 0);
          const probabilities = Object.fromEntries(
            labels.map((label) => [label, (weights[label] ?? 0.1) / total]),
          );
          const best = labels.reduce((a, b) =>
            (probabilities[a] ?? 0) >= (probabilities[b] ?? 0) ? a : b,
          );
          answers[name] = {
            type: "choice",
            choice: best,
            confidence: probabilities[best] ?? 0,
            probabilities,
          };
        } else if (question.type === "score") {
          const top = question.criteria.length - 1;
          const value = Math.round(strength * top * 10) / 10;
          answers[name] = {
            type: "score",
            score: value,
            confidence: 0.8,
            legend: Object.fromEntries(question.criteria.map((c, i) => [String(i), c])),
            probabilities: { [String(Math.round(value))]: 1 },
          };
        } else {
          answers[name] = { type: "noul", noul: Math.max(0, 1 - strength - 0.2) };
        }
      }
      return {
        model: "mock",
        answers,
        usage: { input_tokens: 0, output_tokens: 0 },
      } as unknown as SystemOneResult<Q>;
    },
  };
}
