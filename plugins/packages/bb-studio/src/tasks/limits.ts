// Limits shared by the tasks RPC contract (server) and the task cards (frontend);
// no SDK import, so the frontend bundle can read them.

/** The most task cards one tasks.getMany reads; the cards of a long conversation in one call. */
export const TASKS_GET_MANY_MAX = 200;
