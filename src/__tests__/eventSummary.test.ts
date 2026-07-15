import { describe, it, expect } from "vitest";
import { formatEventSummary } from "../core/eventSummary";

describe("formatEventSummary", () => {
  it("substitutes a single placeholder", () => {
    expect(formatEventSummary("{name} was founded.", { name: "Rivermeet" }))
      .toBe("Rivermeet was founded.");
  });

  it("substitutes multiple placeholders", () => {
    expect(
      formatEventSummary("Wealth of {name} changed by {delta}.", { name: "Rivermeet", delta: 12 })
    ).toBe("Wealth of Rivermeet changed by 12.");
  });

  it("preserves numeric zero", () => {
    expect(formatEventSummary("Wealth changed by {delta}.", { delta: 0 }))
      .toBe("Wealth changed by 0.");
  });

  it("preserves false", () => {
    expect(formatEventSummary("Active: {active}.", { active: false }))
      .toBe("Active: false.");
  });

  it("preserves empty string values", () => {
    expect(formatEventSummary("Name: '{name}'.", { name: "" }))
      .toBe("Name: ''.");
  });

  // Documented policy: a missing argument leaves the {placeholder} token
  // visible in the output rather than crashing or silently deleting it.
  it("leaves the placeholder visible when its argument is missing", () => {
    expect(formatEventSummary("{name} was founded.", {}))
      .toBe("{name} was founded.");
  });

  it("leaves the placeholder visible when arguments are absent entirely", () => {
    expect(formatEventSummary("{name} was founded.", undefined))
      .toBe("{name} was founded.");
  });

  it("returns a template unchanged when it has no placeholders", () => {
    expect(formatEventSummary("A quiet year passed.", { unused: "value" }))
      .toBe("A quiet year passed.");
  });

  it("returns an empty string for an empty template", () => {
    expect(formatEventSummary("", { name: "Rivermeet" })).toBe("");
  });

  it("returns an empty string for an absent template", () => {
    expect(formatEventSummary(undefined, { name: "Rivermeet" })).toBe("");
    expect(formatEventSummary(null, { name: "Rivermeet" })).toBe("");
  });

  it("does not throw on an unknown placeholder not present in arguments", () => {
    expect(() => formatEventSummary("{unknownKey} happened.", { name: "x" })).not.toThrow();
    expect(formatEventSummary("{unknownKey} happened.", { name: "x" })).toBe("{unknownKey} happened.");
  });
});
