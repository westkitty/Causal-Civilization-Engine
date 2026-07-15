import type { HistoricalEvent } from "../core/types";

const BUCKET_SIZE = 10;
const MAX_YEAR = 400;

// Truthful aggregate marker for a range of years on the timeline. A marker
// never claims events occurred at `startYear` — it records the true first
// event year (`jumpYear`) that clicking the marker navigates to.
export interface TimelineMarker {
  startYear: number;
  endYear: number;
  jumpYear: number;
  count: number;
  types: string[];
  label: string;
}

interface MutableBucket {
  startYear: number;
  endYear: number;
  jumpYear: number;
  count: number;
  types: Set<string>;
}

// Builds decade-bucketed markers from recorded ledger events only — no year
// or type is invented. Deterministic regardless of input event order.
export function buildTimelineMarkers(
  events: readonly HistoricalEvent[],
  notableEventTypes: ReadonlySet<string>
): TimelineMarker[] {
  const buckets = new Map<number, MutableBucket>();

  for (const event of events) {
    if (!notableEventTypes.has(event.eventType)) continue;
    const year = event.time.year;
    const startYear = Math.floor(year / BUCKET_SIZE) * BUCKET_SIZE;
    const endYear = Math.min(MAX_YEAR, startYear + BUCKET_SIZE - 1);

    const bucket = buckets.get(startYear);
    if (bucket) {
      bucket.count += 1;
      bucket.jumpYear = Math.min(bucket.jumpYear, year);
      bucket.types.add(event.eventType.replaceAll("_", " "));
    } else {
      buckets.set(startYear, {
        startYear,
        endYear,
        jumpYear: year,
        count: 1,
        types: new Set([event.eventType.replaceAll("_", " ")]),
      });
    }
  }

  return [...buckets.values()]
    .sort((a, b) => a.startYear - b.startYear)
    .map((bucket) => {
      const types = [...bucket.types].sort();
      const rangeLabel = bucket.startYear === bucket.endYear
        ? `Year ${bucket.startYear}`
        : `Years ${bucket.startYear}–${bucket.endYear}`;
      const countLabel = `${bucket.count} recorded event${bucket.count === 1 ? "" : "s"}`;
      return {
        startYear: bucket.startYear,
        endYear: bucket.endYear,
        jumpYear: bucket.jumpYear,
        count: bucket.count,
        types,
        label: `${rangeLabel}: ${countLabel} (${types.join(", ")}), earliest Year ${bucket.jumpYear}`,
      };
    });
}
