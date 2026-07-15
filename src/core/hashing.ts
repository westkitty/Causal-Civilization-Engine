const floatBuffer = new ArrayBuffer(8);
const floatView = new DataView(floatBuffer);

function serializeNumber(num: number): string {
  if (Object.is(num, -0)) return "-0";
  if (!Number.isFinite(num)) {
    if (Number.isNaN(num)) return "NaN";
    return num > 0 ? "Infinity" : "-Infinity";
  }
  floatView.setFloat64(0, num, false); // big endian
  let hex = "";
  for (let i = 0; i < 8; i++) {
    hex += floatView.getUint8(i).toString(16).padStart(2, "0");
  }
  return `f64:${hex}`;
}

export function canonicalStringify(obj: any): string {
  if (obj === null) return "null";
  if (obj === undefined) return "undefined";
  
  const type = typeof obj;
  if (type === "number") {
    return serializeNumber(obj);
  }
  if (type === "boolean") return obj ? "true" : "false";
  if (type === "string") return JSON.stringify(obj);
  if (type === "symbol") throw new Error("Symbol type is not supported in exact state hashing");
  if (type === "function") throw new Error("Function type is not supported in exact state hashing");
  if (type === "bigint") return `bigint:${obj.toString()}`;

  if (Array.isArray(obj)) {
    return "[" + obj.map(item => canonicalStringify(item)).join(",") + "]";
  }

  if (obj instanceof ArrayBuffer || ArrayBuffer.isView(obj)) {
    const view = ArrayBuffer.isView(obj)
      ? new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength)
      : new Uint8Array(obj);
    return `typedarray:[${Array.from(view).join(",")}]`;
  }

  if (obj instanceof Set) {
    const arr = Array.from(obj).map(v => canonicalStringify(v)).sort();
    return `set:[${arr.join(",")}]`;
  }

  if (obj instanceof Map) {
    const keys = Array.from(obj.keys()).sort((a, b) => {
      const sa = canonicalStringify(a);
      const sb = canonicalStringify(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
    const serialized = keys.map(k => `${canonicalStringify(k)}:${canonicalStringify(obj.get(k))}`);
    return `map:{${serialized.join(",")}}`;
  }

  if (obj.constructor !== Object && Object.getPrototypeOf(obj) !== null) {
    throw new Error(`Unsupported state object type: ${obj.constructor.name}`);
  }

  const keys = Object.keys(obj).sort();
  const serializedProps = keys
    .map(k => {
      if (k.startsWith("__transient")) return "";
      const val = canonicalStringify(obj[k]);
      return `${JSON.stringify(k)}:${val}`;
    })
    .filter(Boolean);

  return "{" + serializedProps.join(",") + "}";
}

export function fnv1a64(str: string): string {
  let hVal = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) {
    hVal ^= BigInt(str.charCodeAt(i));
    hVal = BigInt.asUintN(64, hVal * prime);
  }
  return hVal.toString(16).padStart(16, "0");
}

export function deterministicHash(state: any): string {
  const canon = canonicalStringify(state);
  return fnv1a64(canon);
}

// Quantized version for approximate comparisons / tolerance checks
export function canonicalStringifyQuantized(obj: any): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj !== "object") {
    if (typeof obj === "number" && !Number.isInteger(obj)) {
      return obj.toFixed(4);
    }
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(item => canonicalStringifyQuantized(item)).join(",") + "]";
  }
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map(k => {
        if (k.startsWith("__transient")) return "";
        const val = canonicalStringifyQuantized(obj[k]);
        return `${JSON.stringify(k)}:${val}`;
      })
      .filter(Boolean)
      .join(",") +
    "}"
  );
}

export function deterministicHashQuantized(state: any): string {
  return fnv1a64(canonicalStringifyQuantized(state));
}
