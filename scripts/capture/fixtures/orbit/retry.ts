// Retries a failed upload with exponential backoff.
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 10_000;
const MAX_ATTEMPTS = 6;

export async function uploadWithRetry(upload: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await upload();
    } catch (error) {
      if (attempt > MAX_ATTEMPTS) throw error;
      // Doubles each time, but the cap is in seconds while the delay is in ms.
      const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS / 1000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
