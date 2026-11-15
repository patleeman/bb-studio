export function taskFromLoop(loop: Record<string, any>): Record<string, any>;
export function writeLoopTasks(db: unknown, loops: readonly Record<string, any>[]): void;
export function deleteTasks(db: unknown, prefix: string): void;
