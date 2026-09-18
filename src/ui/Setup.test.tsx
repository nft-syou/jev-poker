// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "../i18n";
import { PRESET_PERSONAS } from "../jev/personas";
import { Setup } from "./Setup";
import { DEFAULT_SETTINGS } from "./storage";

initI18n("en");

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
// Clean up explicitly so renders from one test don't leak into the next.
afterEach(cleanup);

describe("Setup", () => {
  it("disables start without an api key and shows a hint", () => {
    render(
      <Setup
        settings={DEFAULT_SETTINGS}
        personas={[...PRESET_PERSONAS]}
        language="en"
        hasApiKey={false}
        onChange={() => {}}
        onStart={() => {}}
        onEditPersonas={() => {}}
        onOpenKey={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Start playing" })).toBeDisabled();
    expect(screen.getByText("Add an API key first.")).toBeInTheDocument();
  });

  it("changes the number of seats and starts when valid", () => {
    const onChange = vi.fn();
    const onStart = vi.fn();
    render(
      <Setup
        settings={DEFAULT_SETTINGS}
        personas={[...PRESET_PERSONAS]}
        language="en"
        hasApiKey={true}
        onChange={onChange}
        onStart={onStart}
        onEditPersonas={() => {}}
        onOpenKey={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Seats"), { target: { value: "3" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ seats: DEFAULT_SETTINGS.seats.slice(0, 3) }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start playing" }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("labels the start button as spectating when no seat is human", () => {
    render(
      <Setup
        settings={{
          ...DEFAULT_SETTINGS,
          seats: DEFAULT_SETTINGS.seats.map((s) => ({ ...s, kind: "cpu" as const })),
        }}
        personas={[...PRESET_PERSONAS]}
        language="en"
        hasApiKey={true}
        onChange={() => {}}
        onStart={() => {}}
        onEditPersonas={() => {}}
        onOpenKey={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Watch the CPUs play" })).toBeEnabled();
  });
});
