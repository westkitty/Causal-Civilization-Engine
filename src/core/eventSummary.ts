// Renders a ledger event's summaryTemplate by substituting {placeholder}
// tokens from summaryArguments. Missing arguments leave the placeholder
// visible rather than silently dropping it or throwing, so an incomplete
// event record is still legible instead of producing a false-looking string.
export function formatEventSummary(
  template: string | undefined | null,
  args: Record<string, unknown> | undefined | null
): string {
  if (!template) return "";
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder, key: string) => {
    if (!args || !(key in args)) return placeholder;
    const value = args[key];
    return value === null || value === undefined ? placeholder : String(value);
  });
}
