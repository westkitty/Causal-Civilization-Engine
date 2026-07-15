export function murmurHash3(key: string, seed: number = 0): number {
  let h1 = seed >>> 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const len = key.length;
  const roundedLen = len & ~0x3;

  for (let i = 0; i < roundedLen; i += 4) {
    let k1 =
      (key.charCodeAt(i) & 0xff) |
      ((key.charCodeAt(i + 1) & 0xff) << 8) |
      ((key.charCodeAt(i + 2) & 0xff) << 16) |
      ((key.charCodeAt(i + 3) & 0xff) << 24);

    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);

    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = Math.imul(h1, 5) + 0xe6546b64;
  }

  let k1 = 0;
  const val = len & 0x3;
  if (val === 3) {
    k1 ^= (key.charCodeAt(roundedLen + 2) & 0xff) << 16;
  }
  if (val >= 2) {
    k1 ^= (key.charCodeAt(roundedLen + 1) & 0xff) << 8;
  }
  if (val >= 1) {
    k1 ^= key.charCodeAt(roundedLen) & 0xff;
    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);
    h1 ^= k1;
  }

  h1 ^= len;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 >>> 0;
}

export function keyedRandom(
  seed: string,
  entityKey: string,
  subsystem: string,
  year: number,
  decisionSlot: string,
  attemptIndex: number = 0
): number {
  const key = `${seed}:${entityKey}:${subsystem}:${year}:${decisionSlot}:${attemptIndex}`;
  const hash = murmurHash3(key);
  return hash / 0xffffffff;
}

// Bounded selection using soft allocation
export function softAllocation<T>(
  items: { item: T; weight: number }[],
  totalToAllocate: number,
  _randomFloat: number
): { item: T; allocated: number }[] {
  if (items.length === 0 || totalToAllocate <= 0) return [];
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return [];

  const results: { item: T; allocated: number }[] = [];
  let remaining = totalToAllocate;

  // allocate proportionally, with residual handled deterministically by randomFloat
  const shares = items.map(item => {
    const exact = (item.weight / totalWeight) * totalToAllocate;
    const floor = Math.floor(exact);
    const remainder = exact - floor;
    remaining -= floor;
    return { item: item.item, floor, remainder };
  });

  // Sort by remainder descending, then allocate remaining units
  shares.sort((a, b) => b.remainder - a.remainder);

  for (let i = 0; i < shares.length; i++) {
    let allocated = shares[i].floor;
    if (remaining > 0) {
      allocated += 1;
      remaining -= 1;
    }
    if (allocated > 0) {
      results.push({ item: shares[i].item, allocated });
    }
  }

  return results;
}
