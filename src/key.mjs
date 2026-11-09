// Reading a key out of what a person typed.

const KEY_PATTERN = /^sk-[A-Za-z0-9_-]{8,}$/

/** Whether the text is one of the site's keys (`sk-` and a body). */
export function looksLikeKey(value) {
  return KEY_PATTERN.test(String(value ?? "").trim())
}
