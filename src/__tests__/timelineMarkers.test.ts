import { describe, it, expect } from "vitest";
import { buildTimelineMarkers } from "../timelines/markers";
import type { HistoricalEvent } from "../core/types";

const NOTABLE = new Set(["founding", "flood", "bridge_construction"]);

function makeEvent(overrides: Partial<HistoricalEvent> & { eventId: string; year: number; eventType: string }): HistoricalEvent {
  return {
    eventId: overrides.eventId,
    branchId: "main",
    time: { year: overrides.year },
    eventType: overrides.eventType,
    location: {} as HistoricalEvent["location"],
    actorIds: [],
    affectedEntityIds: [],
    conditions: [],
    immediateEffects: [],
    parentEventIds: [],
    resultingEventIds: [],
    ruleId: "test_rule",
    summaryTemplate: "",
    summaryArguments: {},
    confidence: 1,
  };
}

describe("buildTimelineMarkers", () => {
  it("groups a Year 24 event into a Years 20-29 bucket", () => {
    const events = [makeEvent({ eventId: "e1", year: 24, eventType: "founding" })];
    const markers = buildTimelineMarkers(events, NOTABLE);
    expect(markers).toHaveLength(1);
    expect(markers[0].startYear).toBe(20);
    expect(markers[0].endYear).toBe(29);
    expect(markers[0].label).toContain("20");
    expect(markers[0].label).toContain("29");
  });

  it("jumps to the actual earliest event year rather than the bucket start", () => {
    const events = [makeEvent({ eventId: "e1", year: 24, eventType: "founding" })];
    const markers = buildTimelineMarkers(events, NOTABLE);
    expect(markers[0].jumpYear).toBe(24);
    expect(markers[0].jumpYear).not.toBe(20);
  });

  it("aggregates multiple years and types deterministically within a bucket", () => {
    const events = [
      makeEvent({ eventId: "e1", year: 27, eventType: "flood" }),
      makeEvent({ eventId: "e2", year: 22, eventType: "founding" }),
      makeEvent({ eventId: "e3", year: 25, eventType: "founding" }),
    ];
    const markersRun1 = buildTimelineMarkers(events, NOTABLE);
    const markersRun2 = buildTimelineMarkers([...events].reverse(), NOTABLE);

    expect(markersRun1).toEqual(markersRun2);
    expect(markersRun1).toHaveLength(1);
    expect(markersRun1[0].count).toBe(3);
    expect(markersRun1[0].jumpYear).toBe(22);
    expect(markersRun1[0].types).toEqual(["flood", "founding"]);
  });

  it("handles Year 400 without producing an invalid 400-409 range", () => {
    const events = [makeEvent({ eventId: "e1", year: 400, eventType: "founding" })];
    const markers = buildTimelineMarkers(events, NOTABLE);
    expect(markers[0].startYear).toBe(400);
    expect(markers[0].endYear).toBe(400);
    expect(markers[0].endYear).not.toBe(409);
  });

  it("produces no markers for an empty event list", () => {
    expect(buildTimelineMarkers([], NOTABLE)).toEqual([]);
  });

  it("ignores events whose type is not notable", () => {
    const events = [makeEvent({ eventId: "e1", year: 24, eventType: "trade_allocation" })];
    expect(buildTimelineMarkers(events, NOTABLE)).toEqual([]);
  });

  it("orders markers by bucket start year", () => {
    const events = [
      makeEvent({ eventId: "e1", year: 350, eventType: "founding" }),
      makeEvent({ eventId: "e2", year: 15, eventType: "founding" }),
      makeEvent({ eventId: "e3", year: 120, eventType: "flood" }),
    ];
    const markers = buildTimelineMarkers(events, NOTABLE);
    expect(markers.map((m) => m.startYear)).toEqual([10, 120, 350]);
  });
});
