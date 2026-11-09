// Reading a session out of its token.
//
// The site's `auth_token` is a JWT: `{user_id, email, role, token_version,
// sid, bnd, exp, nbf, iat}`. Its `exp` is the only expiry we need; a token
// that isn't one is kept without an expiry, and the site's own 401 renews it.

const BEARER = /^Bearer\s+/i

export function stripBearer(value) {
  return String(value ?? "").trim().replace(BEARER, "").trim()
}

/** The token's claims, or null when it doesn't read as a JWT. */
export function claimsOf(token) {
  const raw = stripBearer(token)
  const parts = raw.split(".")
  if (parts.length < 2 || !parts[1]) return null
  try {
    const obj = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null
  } catch {
    return null
  }
}

/** When the token ends, in ms since the epoch; 0 when it doesn't say. */
export function expiryOf(token) {
  const exp = Number(claimsOf(token)?.exp)
  return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0
}

/** The account the token names: its user id, else its email. */
export function accountIdOf(token) {
  const claims = claimsOf(token)
  if (!claims) return ""
  for (const key of ["user_id", "email"]) {
    const value = claims[key]
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return ""
}

/** Whether the record's access token is close enough to its end to renew. */
export function isStale(record, marginMs) {
  const expires = Number(record?.expires) || expiryOf(record?.access)
  return expires > 0 && Date.now() >= expires - marginMs
}

/** Whether the record's access token has ended and can't be used at all. */
export function hasEnded(record) {
  const expires = Number(record?.expires) || expiryOf(record?.access)
  return expires > 0 && Date.now() >= expires
}
