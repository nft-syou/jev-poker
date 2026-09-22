import type {
  Questions,
  RequestOptions,
  SystemOneRequest,
  SystemOneResult,
} from "@typesafe-ai/sdk";

export interface JevBackend {
  readonly kind: "typesafe" | "mock";
  systemOne<const Q extends Questions>(
    request: SystemOneRequest<Q>,
    options?: RequestOptions,
  ): Promise<SystemOneResult<Q>>;
}

export const DEFAULT_MODEL = "jev-latest";
