/**
 * Returns a promise that resolves after `ms` milliseconds.
 * Used internally for retry backoff delays.
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
//# sourceMappingURL=sleep.js.map