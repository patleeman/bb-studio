/** Replace named placeholders while leaving unknown names visible. */
export function fillTemplate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (whole, name: string) =>
    Object.hasOwn(variables, name) ? variables[name]! : whole);
}

export function copyTitle(title: string): string {
  return title.trim() ? `${title.trim()} (copy)` : "Untitled (copy)";
}

/** Fill string leaves in JSON without allowing variable values to break its syntax. */
export function fillTemplateJson(json: string, variables: Record<string, string>): string {
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") return fillTemplate(value, variables);
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
    return value;
  };
  return JSON.stringify(visit(JSON.parse(json)));
}
