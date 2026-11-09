// What the site's answers become when they aren't the answer we asked for.
//
// 只因API answers `{code, message, data}` with `code: 0` for success, and a
// refused call carries a number or a word ("UNAUTHORIZED") and, now and then,
// a `reason` ("REFRESH_TOKEN_INVALID"). The HTTP status says the same thing
// about the sign-in, so both are kept: the check-in reads the code, the hooks
// read `signedOut`.

export class YydsError extends Error {
  constructor(message, { status = 0, code = "", reason = "" } = {}) {
    super(message)
    this.name = "YydsError"
    this.status = status
    this.code = code
    this.reason = reason
  }

  /** The sign-in is gone: signing in again is the only way back. */
  get signedOut() {
    return (
      this.status === 401 ||
      this.reason === "REFRESH_TOKEN_INVALID" ||
      this.code === "UNAUTHORIZED" ||
      this.reason === "UNAUTHORIZED"
    )
  }

  /** The site's own trouble, worth asking again: 5xx, 429, or no answer. */
  get transient() {
    return this.status === 0 || this.status === 429 || this.status >= 500
  }
}

/** A sign-in that expired, thrown where a hook answers with an error. */
export function signedOutError(message) {
  return new YydsError(message, { status: 401 })
}
