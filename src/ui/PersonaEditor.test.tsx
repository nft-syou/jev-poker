// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { PRESET_PERSONAS } from "@jev-poker/agent";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "../i18n";
import { PersonaEditor } from "./PersonaEditor";

initI18n("en");

// @testing-library/react only auto-registers its afterEach(cleanup) hook when a global
// `afterEach` exists, which this project's Vitest config does not enable (no `test.globals`).
// Clean up explicitly so renders from one test don't leak into the next.
afterEach(cleanup);

describe("PersonaEditor", () => {
  it("duplicates a preset into an editable custom persona", () => {
    const onChange = vi.fn();
    render(
      <PersonaEditor
        personas={[...PRESET_PERSONAS]}
        language="en"
        onChange={onChange}
        onBack={() => {}}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: "Duplicate" });
    expect(buttons).toHaveLength(PRESET_PERSONAS.length);
    fireEvent.click(buttons[0] as HTMLElement);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as typeof PRESET_PERSONAS;
    expect(next).toHaveLength(PRESET_PERSONAS.length + 1);
    expect(next[next.length - 1]).toMatchObject({ isPreset: false, name: { en: "Rock (copy)" } });
  });

  it("edits and deletes custom personas only", () => {
    const custom = {
      ...PRESET_PERSONAS[0],
      id: "c1",
      isPreset: false,
    } as (typeof PRESET_PERSONAS)[number];
    const onChange = vi.fn();
    render(
      <PersonaEditor
        personas={[...PRESET_PERSONAS, custom]}
        language="en"
        onChange={onChange}
        onBack={() => {}}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Name (English)"), { target: { value: "Boulder" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "c1", name: { en: "Boulder", ja: custom.name.ja } }),
      ]),
    );
    fireEvent.change(screen.getByLabelText(/Variance/), { target: { value: "0.9" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "c1", variance: 0.9 })]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onChange).toHaveBeenLastCalledWith(PRESET_PERSONAS);
  });
});
