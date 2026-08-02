/** Remove parenthetical asides from desk copy — no bracketed text in the UI. */
export function stripBracketText(value: string): string {
  let out = String(value ?? "");
  // Repeat until stable — nested or sequential "(…)" asides.
  for (let i = 0; i < 8; i += 1) {
    const next = out.replace(/\s*\([^)]*\)/g, "");
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

export function stripBracketDeep<T>(value: T): T {
  if (typeof value === "string") return stripBracketText(value) as T;
  if (Array.isArray(value)) return value.map((v) => stripBracketDeep(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripBracketDeep(v);
    }
    return out as T;
  }
  return value;
}
