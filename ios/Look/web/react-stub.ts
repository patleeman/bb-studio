// desktop's theme and presence modules import React only for hooks the phone never calls.
export function useSyncExternalStore<T>(_subscribe: unknown, read: () => T): T { return read(); }
export function useEffect(): void {}
export function useRef<T>(value: T): { current: T } { return { current: value }; }
export default { useSyncExternalStore, useEffect, useRef };
