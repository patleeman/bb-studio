/** Only a confirmed missing resource is absent. Transport and decode errors are unavailable. */
export type Available<T> = { status: "ok"; value: T } | { status: "absent" } | { status: "unavailable"; error: unknown };

export async function readAvailable<T>(read: () => Promise<T>): Promise<Available<T>> {
  try {
    return { status: "ok", value: await read() };
  } catch (error) {
    const failure = error as { status?: number; code?: string } | null;
    return failure?.status === 404 || failure?.code === "NOT_FOUND" || failure?.code === "not_found"
      ? { status: "absent" }
      : { status: "unavailable", error };
  }
}
