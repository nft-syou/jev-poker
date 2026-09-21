// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "../i18n";
import type { Connection } from "../jev/connection";
import { ConnectionModal } from "./ConnectionModal";

initI18n("en");

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
afterEach(cleanup);

const CF: Connection = {
  route: "cloudflare",
  apiKey: "sk-saved",
  accountId: "0123456789abcdef0123456789abcdef",
  gatewayId: "my-gateway",
  providerSlug: "typesafe",
};

function open(connection: Connection | null = null) {
  const onSave = vi.fn();
  const onRemove = vi.fn();
  const onClose = vi.fn();
  render(
    <ConnectionModal
      open={true}
      connection={connection}
      error={null}
      onSave={onSave}
      onRemove={onRemove}
      onClose={onClose}
    />,
  );
  return { onSave, onRemove, onClose };
}

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const chooseRoute = (route: "typesafe" | "vercel" | "cloudflare") =>
  fireEvent.change(screen.getByLabelText("Route"), { target: { value: route } });

describe("ConnectionModal", () => {
  it("renders nothing when closed", () => {
    render(
      <ConnectionModal
        open={false}
        connection={null}
        error={null}
        onSave={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows only the fields the chosen route needs", () => {
    open();
    expect(screen.getByLabelText("TypeSafe API key")).toBeInTheDocument();
    expect(screen.queryByLabelText("Account ID")).not.toBeInTheDocument();

    chooseRoute("vercel");
    expect(screen.getByLabelText("AI Gateway API key")).toBeInTheDocument();
    expect(screen.queryByLabelText("Account ID")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog").textContent).toContain("typesafe-ai/jev");

    chooseRoute("cloudflare");
    expect(screen.getByLabelText("TypeSafe API key")).toBeInTheDocument();
    for (const label of ["Account ID", "Gateway ID", "Custom provider slug"]) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Gateway token (optional)")).toBeInTheDocument();
    expect(screen.getByRole("dialog").textContent).toContain("https://api.typesafe.ai");
  });

  it("keeps the secrets in password inputs", () => {
    open();
    expect(screen.getByLabelText("TypeSafe API key")).toHaveAttribute("type", "password");
    chooseRoute("cloudflare");
    expect(screen.getByLabelText("Gateway token (optional)")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Account ID")).toHaveAttribute("type", "text");
  });

  it("disables save until every field validates and shows the field errors", () => {
    open();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    chooseRoute("cloudflare");
    type("TypeSafe API key", "sk-1");
    type("Account ID", "nope");
    type("Gateway ID", "my gateway");
    type("Custom provider slug", "Upper Case");
    expect(screen.getByText("The account ID is 32 hexadecimal characters.")).toBeInTheDocument();
    expect(
      screen.getByText("Letters, digits, hyphen and underscore only, up to 64 characters."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Lowercase letters, digits and hyphens only, starting with a letter or digit.",
      ),
    ).toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it("saves a typesafe connection", () => {
    const { onSave } = open();
    type("TypeSafe API key", "  sk-1 ");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ route: "typesafe", apiKey: "sk-1" });
  });

  it("saves a vercel connection", () => {
    const { onSave } = open();
    chooseRoute("vercel");
    type("AI Gateway API key", "vck_1");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ route: "vercel", apiKey: "vck_1" });
  });

  it("normalizes the provider slug and keeps the token optional", () => {
    const { onSave } = open();
    chooseRoute("cloudflare");
    type("TypeSafe API key", "sk-cf");
    type("Account ID", "0123456789ABCDEF0123456789abcdef");
    type("Gateway ID", "my-gateway");
    type("Custom provider slug", " Custom-TypeSafe ");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      route: "cloudflare",
      apiKey: "sk-cf",
      accountId: "0123456789ABCDEF0123456789abcdef",
      gatewayId: "my-gateway",
      providerSlug: "typesafe",
    });

    type("Gateway token (optional)", "tok-1");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ gatewayToken: "tok-1" }));
  });

  it("prefills the non-secret fields and keeps the saved key when the input is left blank", () => {
    const { onSave } = open(CF);
    expect(screen.getByLabelText("Route")).toHaveValue("cloudflare");
    expect(screen.getByLabelText("Account ID")).toHaveValue(CF.accountId);
    expect(screen.getByLabelText("Gateway ID")).toHaveValue("my-gateway");
    expect(screen.getByLabelText("Custom provider slug")).toHaveValue("typesafe");
    expect(screen.getByLabelText("TypeSafe API key")).toHaveValue("");
    expect(screen.getByText("Leave blank to keep the saved key.")).toBeInTheDocument();

    // Blank secret, changed gateway: the saved key is reused.
    type("Gateway ID", "other-gateway");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ ...CF, gatewayId: "other-gateway" });
  });

  it("asks for a new key when the route changes, since the saved one belongs elsewhere", () => {
    open({ route: "typesafe", apiKey: "sk-saved" });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    chooseRoute("vercel");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByText("Leave blank to keep the saved key.")).not.toBeInTheDocument();
  });

  it("offers remove and close only once something is saved", () => {
    open();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    cleanup();

    const { onRemove, onClose } = open(CF);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("states where the credentials go", () => {
    open();
    expect(screen.getByRole("dialog").textContent).toContain(
      "stored only in this browser's localStorage",
    );
    expect(screen.getByRole("link", { name: "Get a key at typesafe.ai" })).toHaveAttribute(
      "href",
      "https://typesafe.ai",
    );
    chooseRoute("cloudflare");
    expect(
      screen.getByRole("link", { name: "Cloudflare AI Gateway: custom providers" }),
    ).toHaveAttribute(
      "href",
      "https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/",
    );
  });
});
