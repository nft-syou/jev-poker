import { describe, expect, it } from "vitest";
import {
  API_KEY_HEADER,
  CF_ACCOUNT_HEADER,
  CF_GATEWAY_HEADER,
  CF_PROVIDER_HEADER,
  CF_TOKEN_HEADER,
  type Connection,
  connectionHeaders,
  LOLIPOP_MODEL,
  modelFor,
  normalizeProviderSlug,
  ROUTE_HEADER,
  upstreamUrl,
  VERCEL_MODEL,
  validateConnection,
} from "./connection";

const CF: Connection = {
  route: "cloudflare",
  apiKey: "sk-cf",
  accountId: "0123456789abcdef0123456789abcdef",
  gatewayId: "my-gateway",
  providerSlug: "typesafe",
};

type CfPatch = Partial<Record<"accountId" | "gatewayId" | "providerSlug", unknown>>;

const CF_CONFIG = {
  accountId: CF.accountId,
  gatewayId: CF.gatewayId,
  providerSlug: CF.providerSlug,
};

function errorsOf(input: unknown): Record<string, string> {
  const result = validateConnection(input);
  if (result.ok) throw new Error("expected the connection to be rejected");
  return result.errors as Record<string, string>;
}

function connectionOf(input: unknown): Connection {
  const result = validateConnection(input);
  if (!result.ok)
    throw new Error(`expected the connection to be accepted: ${JSON.stringify(result.errors)}`);
  return result.connection;
}

describe("normalizeProviderSlug", () => {
  it("trims, lowercases and strips one leading custom- prefix", () => {
    expect(normalizeProviderSlug("  Custom-TypeSafe ")).toBe("typesafe");
    expect(normalizeProviderSlug("CUSTOM-jev-gw")).toBe("jev-gw");
    expect(normalizeProviderSlug("typesafe")).toBe("typesafe");
    // Only one prefix is stripped, so a provider literally named `custom-x` survives.
    expect(normalizeProviderSlug("custom-custom-x")).toBe("custom-x");
    expect(normalizeProviderSlug("custom-")).toBe("");
  });
});

/**
 * The UI saves what `validateConnection` accepts and the proxy rebuilds the URL from it, so a
 * slug the one accepts and the other refuses would be a 400 on every hand with nothing to see
 * in the modal. Both layers answer this table identically.
 */
describe("provider slug agreement between the validator and the url builder", () => {
  const cases: [raw: string, accepted: boolean, slugInUrl: string][] = [
    ["typesafe", true, "typesafe"],
    ["custom-typesafe", true, "typesafe"],
    ["Custom-TypeSafe", true, "typesafe"],
    ["custom-custom-x", false, ""],
    ["custom-", false, ""],
  ];

  for (const [raw, accepted, slug] of cases) {
    it(`${accepted ? "accepts" : "refuses"} ${JSON.stringify(raw)} in both layers`, () => {
      const result = validateConnection({ ...CF, providerSlug: raw });
      expect(result.ok).toBe(accepted);
      if (!result.ok) {
        expect(result.errors.providerSlug).toBe("connection.error.providerSlug");
        // Whatever the validator refuses, the builder refuses too — after normalization.
        expect(
          upstreamUrl(
            "cloudflare",
            "v1/systemone",
            { ...CF_CONFIG, providerSlug: normalizeProviderSlug(raw) },
            {},
          ),
        ).toEqual({ error: "invalid_gateway_config" });
        return;
      }
      const connection = result.connection;
      if (connection.route !== "cloudflare") throw new Error("expected the cloudflare route");
      expect(connection.providerSlug).toBe(slug);
      expect(upstreamUrl("cloudflare", "v1/systemone", connection, {})).toBe(
        `https://gateway.ai.cloudflare.com/v1/${CF.accountId}/my-gateway/custom-${slug}/v1/systemone`,
      );
    });
  }
});

describe("validateConnection", () => {
  it("accepts the listed routes and rejects anything else", () => {
    expect(connectionOf({ route: "typesafe", apiKey: "sk-1" })).toEqual({
      route: "typesafe",
      apiKey: "sk-1",
    });
    expect(connectionOf({ route: "vercel", apiKey: "vck_1" })).toEqual({
      route: "vercel",
      apiKey: "vck_1",
    });
    expect(connectionOf({ route: "lolipop", apiKey: "lp-1" })).toEqual({
      route: "lolipop",
      apiKey: "lp-1",
    });
    for (const route of ["", "TypeSafe", "openai", "typesafe ", null, 7, undefined]) {
      expect(errorsOf({ route, apiKey: "sk-1" }).route, String(route)).toBe(
        "connection.error.route",
      );
    }
    expect(errorsOf(null).route).toBe("connection.error.route");
    expect(errorsOf("typesafe").route).toBe("connection.error.route");
  });

  it("trims the api key and enforces its printable-ascii boundaries", () => {
    expect(connectionOf({ route: "typesafe", apiKey: "  sk-1  " }).apiKey).toBe("sk-1");
    expect(connectionOf({ route: "typesafe", apiKey: "!" }).apiKey).toBe("!");
    expect(connectionOf({ route: "typesafe", apiKey: "~".repeat(512) }).apiKey).toHaveLength(512);
    for (const apiKey of [
      "",
      "   ",
      "~".repeat(513),
      "sk key",
      "sk\tkey",
      "sk\nkey",
      "sk\r\nkey",
      "sk-é",
      "sk-あ",
      "sk-\u0000",
      "sk-\u007f",
      42,
      null,
      undefined,
    ]) {
      expect(errorsOf({ route: "typesafe", apiKey }).apiKey, JSON.stringify(apiKey)).toBe(
        "connection.error.apiKey",
      );
    }
  });

  it("validates every cloudflare field at its boundaries", () => {
    expect(connectionOf(CF)).toEqual(CF);
    // Hex, exactly 32, case-insensitive; the slug is normalized on the way in.
    expect(
      connectionOf({
        ...CF,
        accountId: "  0123456789ABCDEF0123456789ABCDEF ",
        gatewayId: "  my-gateway ",
        providerSlug: " Custom-TypeSafe ",
      }),
      // Hex is case-insensitive but the id is stored lowercased, so one saved connection
      // cannot differ from another only by case.
    ).toEqual(CF);

    for (const accountId of [
      "",
      "0123456789abcdef0123456789abcde",
      "0123456789abcdef0123456789abcdef0",
      "0123456789abcdef0123456789abcdeg",
      "0123456789abcdef0123456789abcde/",
      "../0123456789abcdef0123456789abc",
      "%2e%2e%2f0123456789abcdef0123456",
      "0123456789abcdef0123456789abcd\n1",
      null,
    ]) {
      expect(errorsOf({ ...CF, accountId }).accountId, String(accountId)).toBe(
        "connection.error.accountId",
      );
    }

    expect(connectionOf({ ...CF, gatewayId: "A" }).route).toBe("cloudflare");
    expect(connectionOf({ ...CF, gatewayId: `${"a_B-9".repeat(12)}aaaa` }).route).toBe(
      "cloudflare",
    );
    for (const gatewayId of [
      "",
      "a".repeat(65),
      "my gateway",
      "my/gateway",
      "my.gateway",
      "../etc",
      "%2e%2e",
      "gw?x=1",
      "gw#frag",
      "gw\nx",
      "gw\r\nx",
      "gwあ",
      7,
    ]) {
      expect(errorsOf({ ...CF, gatewayId }).gatewayId, JSON.stringify(gatewayId)).toBe(
        "connection.error.gatewayId",
      );
    }

    expect(connectionOf({ ...CF, providerSlug: "a" }).route).toBe("cloudflare");
    expect(connectionOf({ ...CF, providerSlug: `a${"b".repeat(62)}` }).route).toBe("cloudflare");
    for (const providerSlug of [
      "",
      "custom-",
      `a${"b".repeat(63)}`,
      "-leading",
      "under_score",
      "Upper Case",
      "a/b",
      "a.b",
      "../x",
      "%2e%2e",
      "a?x=1",
      "a#frag",
      "a b",
      "a\nb",
      "aあ",
      null,
    ]) {
      expect(errorsOf({ ...CF, providerSlug }).providerSlug, JSON.stringify(providerSlug)).toBe(
        "connection.error.providerSlug",
      );
    }
  });

  it("treats a blank gateway token as absent and validates a supplied one", () => {
    expect(connectionOf({ ...CF, gatewayToken: "  " })).toEqual(CF);
    expect(connectionOf({ ...CF, gatewayToken: undefined })).toEqual(CF);
    expect(connectionOf({ ...CF, gatewayToken: " tok-1 " })).toEqual({
      ...CF,
      gatewayToken: "tok-1",
    });
    expect(connectionOf({ ...CF, gatewayToken: "~".repeat(512) }).route).toBe("cloudflare");
    for (const gatewayToken of ["~".repeat(513), "tok 1", "tok\n1", "tok\r\n1", "tokあ", 5]) {
      expect(errorsOf({ ...CF, gatewayToken }).gatewayToken, JSON.stringify(gatewayToken)).toBe(
        "connection.error.gatewayToken",
      );
    }
  });

  it("ignores cloudflare fields on the other routes", () => {
    expect(
      connectionOf({ route: "vercel", apiKey: "k", accountId: "../", gatewayId: "a b" }),
    ).toEqual({
      route: "vercel",
      apiKey: "k",
    });
  });

  it("reports every broken field at once", () => {
    expect(
      errorsOf({
        route: "cloudflare",
        apiKey: "",
        accountId: "x",
        gatewayId: "",
        providerSlug: "",
      }),
    ).toEqual({
      apiKey: "connection.error.apiKey",
      accountId: "connection.error.accountId",
      gatewayId: "connection.error.gatewayId",
      providerSlug: "connection.error.providerSlug",
    });
  });
});

describe("connectionHeaders", () => {
  it("sends the key plus the route, and the four cf headers only on the cloudflare route", () => {
    expect(connectionHeaders({ route: "typesafe", apiKey: "sk-1" })).toEqual({
      [API_KEY_HEADER]: "sk-1",
      [ROUTE_HEADER]: "typesafe",
    });
    expect(connectionHeaders({ route: "vercel", apiKey: "vck" })).toEqual({
      [API_KEY_HEADER]: "vck",
      [ROUTE_HEADER]: "vercel",
    });
    expect(connectionHeaders({ route: "lolipop", apiKey: "lp" })).toEqual({
      [API_KEY_HEADER]: "lp",
      [ROUTE_HEADER]: "lolipop",
    });
    expect(connectionHeaders(CF)).toEqual({
      [API_KEY_HEADER]: "sk-cf",
      [ROUTE_HEADER]: "cloudflare",
      [CF_ACCOUNT_HEADER]: CF.accountId,
      [CF_GATEWAY_HEADER]: "my-gateway",
      [CF_PROVIDER_HEADER]: "typesafe",
    });
    expect(connectionHeaders({ ...CF, gatewayToken: "tok" })[CF_TOKEN_HEADER]).toBe("tok");
  });
});

describe("modelFor", () => {
  it("pins each reselling gateway to its own model id and passes the setting through elsewhere", () => {
    expect(modelFor({ route: "vercel", apiKey: "k" }, "jev-latest")).toBe(VERCEL_MODEL);
    expect(VERCEL_MODEL).toBe("typesafe-ai/jev");
    expect(modelFor({ route: "lolipop", apiKey: "k" }, "jev-2026-09")).toBe(LOLIPOP_MODEL);
    expect(LOLIPOP_MODEL).toBe("typesafe/jev-latest");
    expect(modelFor({ route: "typesafe", apiKey: "k" }, "jev-latest")).toBe("jev-latest");
    expect(modelFor(CF, "jev-2026-09")).toBe("jev-2026-09");
  });
});

describe("upstreamUrl", () => {
  it("builds the exact url for every route and both paths", () => {
    expect(upstreamUrl("typesafe", "v1/systemone", null, {})).toBe(
      "https://api.typesafe.ai/v1/systemone",
    );
    expect(upstreamUrl("typesafe", "v1/models", null, {})).toBe(
      "https://api.typesafe.ai/v1/models",
    );
    expect(upstreamUrl("vercel", "v1/systemone", null, {})).toBe(
      "https://ai-gateway.vercel.sh/typesafe/v1/systemone",
    );
    expect(upstreamUrl("vercel", "v1/models", null, {})).toBe(
      "https://ai-gateway.vercel.sh/typesafe/v1/models",
    );
    expect(upstreamUrl("lolipop", "v1/systemone", null, {})).toBe(
      "https://ai-gateway.lolipop.jp/v1/systemone",
    );
    expect(upstreamUrl("lolipop", "v1/models", null, {})).toBe(
      "https://ai-gateway.lolipop.jp/v1/models",
    );
    expect(upstreamUrl("cloudflare", "v1/systemone", CF_CONFIG, {})).toBe(
      "https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/my-gateway/custom-typesafe/v1/systemone",
    );
    expect(upstreamUrl("cloudflare", "v1/models", CF_CONFIG, {})).toBe(
      "https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/my-gateway/custom-typesafe/v1/models",
    );
  });

  it("ignores a TYPESAFE_BASE_URL that is not an https (or local http) origin", () => {
    // A typo must never yield a relative URL or send keys somewhere unencrypted.
    for (const TYPESAFE_BASE_URL of [
      "",
      "   ",
      "api.typesafe.ai",
      "/v1",
      "//evil.test",
      "http://evil.test",
      "https:/api.typesafe.ai",
      "ftp://api.typesafe.ai",
      "javascript:alert(1)",
      "https://api.typesafe.ai extra",
    ]) {
      expect(
        upstreamUrl("typesafe", "v1/systemone", null, { TYPESAFE_BASE_URL }),
        JSON.stringify(TYPESAFE_BASE_URL),
      ).toBe("https://api.typesafe.ai/v1/systemone");
    }
    for (const base of [
      "https://staging.typesafe.test",
      "http://localhost:8787",
      "http://127.0.0.1:1234/base",
    ]) {
      expect(upstreamUrl("typesafe", "v1/models", null, { TYPESAFE_BASE_URL: base }), base).toBe(
        `${base}/v1/models`,
      );
    }
  });

  it("honours TYPESAFE_BASE_URL on the typesafe route only", () => {
    const env = { TYPESAFE_BASE_URL: "https://example.test/" };
    expect(upstreamUrl("typesafe", "v1/models", null, env)).toBe("https://example.test/v1/models");
    expect(upstreamUrl("vercel", "v1/models", null, env)).toBe(
      "https://ai-gateway.vercel.sh/typesafe/v1/models",
    );
    expect(upstreamUrl("cloudflare", "v1/models", CF_CONFIG, env)).toBe(
      "https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/my-gateway/custom-typesafe/v1/models",
    );
  });

  it("defaults a missing route to typesafe and refuses any other route id", () => {
    expect(upstreamUrl(null, "v1/systemone", null, {})).toBe(
      "https://api.typesafe.ai/v1/systemone",
    );
    expect(upstreamUrl(undefined, "v1/systemone", null, {})).toBe(
      "https://api.typesafe.ai/v1/systemone",
    );
    for (const route of ["", "Vercel", "typesafe ", "openai", "https://evil.test", "__proto__"]) {
      expect(upstreamUrl(route, "v1/systemone", null, {}), route).toEqual({
        error: "invalid_route",
      });
    }
  });

  it("refuses paths outside the allow-list, including traversal and injection", () => {
    for (const path of [
      "",
      "v1",
      "v1/other",
      "v1/systemone/",
      "/v1/systemone",
      "../v1/systemone",
      "v1%2fsystemone",
      "v1/systemone?x=1",
      "v1/systemone#f",
      "constructor",
      "__proto__",
      "toString",
    ]) {
      expect(upstreamUrl("typesafe", path, null, {}), path).toEqual({ error: "invalid_path" });
      expect(upstreamUrl("cloudflare", path, CF_CONFIG, {}), path).toEqual({
        error: "invalid_path",
      });
    }
  });

  it("refuses a cloudflare config that fails any regex, without inventing a url", () => {
    expect(upstreamUrl("cloudflare", "v1/systemone", null, {})).toEqual({
      error: "invalid_gateway_config",
    });
    const broken: CfPatch[] = [
      { accountId: "../../evil" },
      { accountId: "0123456789abcdef0123456789abcde" },
      { gatewayId: "gw/../.." },
      { gatewayId: "gw?x=1" },
      { gatewayId: "" },
      { providerSlug: "a/b" },
      { providerSlug: "%2e%2e" },
      { providerSlug: "custom-" },
      { providerSlug: "Upper" },
      { accountId: undefined },
      { gatewayId: undefined },
      { providerSlug: undefined },
    ];
    for (const patch of broken) {
      expect(
        upstreamUrl("cloudflare", "v1/systemone", { ...CF_CONFIG, ...patch }, {}),
        JSON.stringify(patch),
      ).toEqual({ error: "invalid_gateway_config" });
    }
  });

  it("never lets a gateway field escape its url segment", () => {
    const url = upstreamUrl("cloudflare", "v1/systemone", CF_CONFIG, {});
    expect(typeof url).toBe("string");
    expect(new URL(String(url)).origin).toBe("https://gateway.ai.cloudflare.com");
    expect(new URL(String(url)).pathname).toBe(
      "/v1/0123456789abcdef0123456789abcdef/my-gateway/custom-typesafe/v1/systemone",
    );
  });

  it("keeps a free-form url out: an absolute url in any field is refused", () => {
    for (const field of ["accountId", "gatewayId", "providerSlug"] as const) {
      expect(
        upstreamUrl(
          "cloudflare",
          "v1/systemone",
          { ...CF_CONFIG, [field]: "https://evil.test" },
          {},
        ),
        field,
      ).toEqual({ error: "invalid_gateway_config" });
    }
  });
});
