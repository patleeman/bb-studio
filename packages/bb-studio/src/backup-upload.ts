// Shared by the server and the Setup page. It must not import
// "@get-bb/plugin-sdk": an installed plugin's frontend bundle can't resolve it.

/** Base64 of 4 MiB: one upload chunk. */
export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
