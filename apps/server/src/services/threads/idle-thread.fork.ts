export function createsIdleThread(request: {
  originKind?: string | null;
  origin?: string | null;
  input: readonly unknown[];
}): boolean {
  return (
    (request.originKind ?? null) === null &&
    request.origin === "plugin" &&
    request.input.length === 0
  );
}
