import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type Connection,
  type ConnectionErrors,
  JEV_ROUTES,
  type JevRoute,
  validateConnection,
} from "../jev/connection";

interface Props {
  open: boolean;
  connection: Connection | null;
  error: string | null;
  onSave: (connection: Connection) => void;
  onRemove: () => void;
  onClose: () => void;
}

interface Form {
  route: JevRoute;
  apiKey: string;
  accountId: string;
  gatewayId: string;
  providerSlug: string;
  gatewayToken: string;
}

type TextField = Exclude<keyof Form, "route">;

const HELP_LINKS: Record<JevRoute, string> = {
  typesafe: "https://typesafe.ai",
  vercel: "https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe",
  lolipop: "https://ai-gateway.lolipop.jp/docs/guides/features/probabilistic-decision",
  cloudflare: "https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/",
};

/** Secrets are never echoed back into the inputs; the non-secret fields are prefilled. */
function formFor(connection: Connection | null): Form {
  const empty = { apiKey: "", gatewayToken: "" };
  if (connection === null) {
    return { route: "typesafe", accountId: "", gatewayId: "", providerSlug: "", ...empty };
  }
  if (connection.route !== "cloudflare") {
    return { route: connection.route, accountId: "", gatewayId: "", providerSlug: "", ...empty };
  }
  return {
    route: "cloudflare",
    accountId: connection.accountId,
    gatewayId: connection.gatewayId,
    providerSlug: connection.providerSlug,
    ...empty,
  };
}

/**
 * A blank secret means "keep the one already saved" — but only while the route is unchanged:
 * a TypeSafe key is no use to the Vercel gateway, so switching routes always asks again.
 */
function secretsFor(form: Form, connection: Connection | null): { apiKey: string; token: string } {
  const saved = connection !== null && connection.route === form.route ? connection : null;
  const apiKey = form.apiKey.trim().length > 0 ? form.apiKey : (saved?.apiKey ?? "");
  const savedToken = saved?.route === "cloudflare" ? (saved.gatewayToken ?? "") : "";
  const token = form.gatewayToken.trim().length > 0 ? form.gatewayToken : savedToken;
  return { apiKey, token };
}

export function ConnectionModal({ open, connection, error, onSave, onRemove, onClose }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [form, setForm] = useState<Form>(() => formFor(connection));
  // Re-seed the form whenever the saved connection changes underneath it.
  const [seeded, setSeeded] = useState(connection);
  if (seeded !== connection) {
    setSeeded(connection);
    setForm(formFor(connection));
  }
  if (!open) return null;

  const { apiKey, token } = secretsFor(form, connection);
  const candidate = {
    route: form.route,
    apiKey,
    accountId: form.accountId,
    gatewayId: form.gatewayId,
    providerSlug: form.providerSlug,
    ...(token.length > 0 ? { gatewayToken: token } : {}),
  };
  const result = validateConnection(candidate);
  const errors: ConnectionErrors = result.ok ? {} : result.errors;
  const patch = (next: Partial<Form>) => setForm({ ...form, ...next });

  const field = (
    name: TextField,
    label: string,
    options: { secret?: boolean; hint?: string } = {},
  ) => (
    <div className="field">
      <label htmlFor={`${id}-${name}`}>{label}</label>
      <input
        id={`${id}-${name}`}
        type={options.secret === true ? "password" : "text"}
        autoComplete="off"
        spellCheck={false}
        placeholder={options.secret === true ? t("connection.placeholder") : ""}
        value={form[name]}
        onChange={(e) => patch({ [name]: e.target.value } as Partial<Form>)}
      />
      {options.hint !== undefined && <p className="muted">{options.hint}</p>}
      {errors[name] !== undefined && (
        <p className="error" role="alert">
          {t(errors[name])}
        </p>
      )}
    </div>
  );

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>{t("connection.title")}</h2>
        <p>{t("connection.description")}</p>
        <p className="muted">{t("connection.privacy")}</p>
        {error !== null && <p className="error">{error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // The secrets stay in the form: saving re-seeds it through the `connection` prop.
            if (result.ok) onSave(result.connection);
          }}
        >
          <div className="field">
            <label htmlFor={`${id}-route`}>{t("connection.route")}</label>
            <select
              id={`${id}-route`}
              value={form.route}
              onChange={(e) => patch({ route: e.target.value as JevRoute })}
            >
              {JEV_ROUTES.map((route) => (
                <option key={route} value={route}>
                  {t(`connection.route_${route}`)}
                </option>
              ))}
            </select>
          </div>

          {field("apiKey", t(`connection.apiKey_${form.route}`), { secret: true })}
          {connection !== null && connection.route === form.route && (
            <p className="muted">{t("connection.keepSecret")}</p>
          )}

          {form.route === "cloudflare" && (
            <>
              {field("accountId", t("connection.accountId"))}
              {field("gatewayId", t("connection.gatewayId"))}
              {field("providerSlug", t("connection.providerSlug"), {
                hint: t("connection.providerSlugHint"),
              })}
              {field("gatewayToken", t("connection.gatewayToken"), {
                secret: true,
                hint: t("connection.gatewayTokenHint"),
              })}
            </>
          )}

          <p className="muted">{t(`connection.help_${form.route}`)}</p>

          <div className="row">
            <button type="submit" disabled={!result.ok}>
              {t("connection.save")}
            </button>
            {connection !== null && (
              <button type="button" className="secondary" onClick={onRemove}>
                {t("connection.remove")}
              </button>
            )}
            {connection !== null && (
              <button type="button" className="secondary" onClick={onClose}>
                {t("connection.close")}
              </button>
            )}
          </div>
        </form>
        <p>
          <a href={HELP_LINKS[form.route]} target="_blank" rel="noreferrer">
            {t(`connection.link_${form.route}`)}
          </a>
        </p>
      </div>
    </div>
  );
}
