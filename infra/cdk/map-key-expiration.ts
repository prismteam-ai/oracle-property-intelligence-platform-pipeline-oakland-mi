/** Keep fourteen review days after the bounded preparation/verification window. */
export const MAP_KEY_MAX_LIFETIME_MS = 14 * 86400000 + 4 * 3600000;

export function validMapKeyExpiration(expires: string, now = Date.now()) {
  const time = Date.parse(expires);
  return (
    Number.isFinite(now) &&
    Number.isFinite(time) &&
    time > now &&
    time <= now + MAP_KEY_MAX_LIFETIME_MS
  );
}
