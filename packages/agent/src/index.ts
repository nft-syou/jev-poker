export {
  type Agent,
  type AgentDecision,
  type BaselineId,
  CallerAgent,
  chartPreflop,
  createAgent,
  HeuristicAgent,
  JevAgent,
  type JevAgentOptions,
  RandomAgent,
  RulesAgent,
} from "./agents/index.js";
export {
  createTypeSafeBackend,
  DEFAULT_MODEL,
  type JevBackend,
  type TypeSafeBackendOptions,
} from "./backend.js";
export {
  type DecideInput,
  type DecisionJev,
  type DecisionRecord,
  decideAction,
  fallbackAction,
  type SizingSnapshot,
  sizingToAmount,
} from "./decide.js";
export {
  // Re-exported so callers who build features from events can name this type without also
  // depending on @jev-poker/engine; it is the identical type as the engine's own export.
  type ActionTakenEvent,
  type BuildFeaturesInput,
  buildFeatures,
  type DecisionFeatures,
  type FeatureOptions,
  type FeaturesHand,
  type FeaturesHistoryEntry,
  type FeaturesSeat,
  type FeaturesTable,
  featuresFromView,
  type OpponentStats,
  type PersonaPrompt,
} from "./features.js";
export { createMockBackend } from "./mock-backend.js";
export {
  buildClassifyQuestions,
  classifyByThresholds,
  classifyWithJev,
  MIN_HANDS_FOR_TYPE,
  OPPONENT_TYPE_GUIDANCE,
  OPPONENT_TYPES,
  OPPONENT_TYPES_INTRO,
  type OpponentType,
} from "./opponent-type.js";
export {
  clampVariance,
  duplicatePersona,
  type KeyValueStorage,
  type LocalizedText,
  loadPersonas,
  type Persona,
  PRESET_PERSONAS,
  personaPrompt,
  saveCustomPersonas,
} from "./personas.js";
export { type PlayHandOptions, playHand } from "./play.js";
export {
  ACTION_LABELS,
  type ActionLabel,
  buildQuestions,
  legalLabels,
  type PokerQuestions,
  type PromptStyle,
  type QuestionOptions,
  SIZING_RUBRIC,
  type SizingRubric,
} from "./questions.js";
