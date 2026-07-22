import { describe, expect, it } from "vitest";
import type { HistoricalEvent } from "../core/types";
import { CausalLedger, diffEntity } from "../timelines/ledger";

function event(eventId: string, year: number, parentEventIds: string[] = []): Omit<HistoricalEvent, "branchId"> {
  return {
    eventId,
    time: { year },
    eventType: "test_event",
    location: {},
    actorIds: [],
    affectedEntityIds: ["entity"],
    conditions: [],
    immediateEffects: [],
    parentEventIds,
    resultingEventIds: [],
    ruleId: "test_rule",
    summaryTemplate: eventId,
    summaryArguments: {},
    confidence: 1,
  };
}

describe("CausalLedger hardening", () => {
  it("returns deterministic chronological ordering with event-id tie breaking", () => {
    const ledger = new CausalLedger();
    ledger.addEvent(event("z", 2));
    ledger.addEvent(event("b", 1));
    ledger.addEvent(event("a", 1));

    expect(ledger.getAllEvents().map(item => item.eventId)).toEqual(["a", "b", "z"]);
  });

  it("invalidates the ordered cache after appending or replacing events", () => {
    const ledger = new CausalLedger();
    ledger.addEvent(event("b", 2));
    expect(ledger.getAllEvents().map(item => item.eventId)).toEqual(["b"]);

    ledger.addEvent(event("a", 1));
    expect(ledger.getAllEvents().map(item => item.eventId)).toEqual(["a", "b"]);

    ledger.events = { c: { ...event("c", 0), branchId: "main" } };
    expect(ledger.getAllEvents().map(item => item.eventId)).toEqual(["c"]);
  });

  it("traces deep ancestry without mutating the source ledger", () => {
    const ledger = new CausalLedger();
    ledger.addEvent(event("root", 0));
    ledger.addEvent(event("middle", 1, ["root"]));
    ledger.addEvent(event("leaf", 2, ["middle"]));

    expect(ledger.traceAncestry("leaf")).toEqual(["middle", "root"]);
    expect(ledger.getAllEvents()).toHaveLength(3);
  });

  it("clones event data independently and assigns the requested branch", () => {
    const ledger = new CausalLedger("main");
    ledger.addEvent(event("root", 0));
    const clone = ledger.clone("counterfactual");

    clone.events.root.summaryTemplate = "changed";
    expect(ledger.events.root.summaryTemplate).toBe("root");
    expect(clone.branchId).toBe("counterfactual");
  });
});

describe("diffEntity completeness", () => {
  it("records changed, added, and deleted fields", () => {
    const deltas = diffEntity(
      "entity",
      "component",
      { retained: 1, changed: 2, deleted: 3 },
      { retained: 1, changed: 4, added: 5 },
    );

    expect(deltas).toEqual([
      { entityId: "entity", component: "component", field: "changed", before: 2, after: 4 },
      { entityId: "entity", component: "component", field: "deleted", before: 3, after: null },
      { entityId: "entity", component: "component", field: "added", before: null, after: 5 },
    ]);
  });
});
