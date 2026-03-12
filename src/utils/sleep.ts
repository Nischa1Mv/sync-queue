/**
 * Returns a promise that resolves after `ms` milliseconds.
 * Used internally for retry backoff delays.
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
