/**
 * Lightweight ID generator. No external dependency.
 * Produces a 21-character URL-safe random string.
 */
export function nanoid(size = 21): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let result = '';
  for (let i = 0; i < size; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
