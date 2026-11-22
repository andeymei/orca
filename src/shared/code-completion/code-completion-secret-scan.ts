/**
 * The scan that keeps code that looks like a secret from leaving the machine.
 *
 * Why: the text around the cursor is sent to a provider, and a provider is somebody else's
 * computer. A key, a token or a password that sits near the cursor would go with it, and the
 * person who typed it never meant to hand it over. The rules are for patterns that are rarely
 * anything else, so ordinary code is not held back.
 *
 * The scan answers with the kind of secret and never with the secret itself.
 */

/** Values that are obviously stand-ins, not real secrets. */
const PLACEHOLDER =
  /^(?:x{3,}|\*{3,}|\.{3,}|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|your[_-].*|example.*|changeme|placeholder.*|secret|password|token)$/i

type Rule = { kind: string; pattern: RegExp }

const RULES: readonly Rule[] = [
  // Either end of a block: a window can hold the middle and one marker, or only the body.
  { kind: 'private key', pattern: /-----(?:BEGIN|END) (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  // The body of a key or a certificate: several whole lines of base64, as PEM and MIME wrap them.
  {
    kind: 'key body',
    pattern: /(?:^[ \t]*["']?[A-Za-z0-9+/]{60,80}={0,2}["']?[ \t]*,?[ \t]*\r?\n){3}/m
  },
  { kind: 'AWS access key', pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b/ },
  {
    kind: 'AWS secret key',
    pattern: /aws_secret_access_key\s*[=:]\s*["']?[A-Za-z0-9/+=]{40}\b/i
  },
  { kind: 'API key (sk-)', pattern: /\bsk-(?:ant-|proj-|live-|or-)?[A-Za-z0-9_-]{20,}/ },
  {
    kind: 'GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/
  },
  { kind: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { kind: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: 'Stripe key', pattern: /\b[sr]k_(?:live|test)_[0-9a-zA-Z]{16}\b/ },
  {
    kind: 'JSON web token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/
  },
  {
    kind: 'password in a URL',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:[^\s@/"']{3,}@/i
  }
]

/** A name that says "secret" assigned a long literal: `apiKey = "…"`, `password: '…'`. */
const ASSIGNED_SECRET =
  /(?:pass(?:word|wd)?|secret|api[_-]?key|access[_-]?key|auth[_-]?token|private[_-]?key|token)["']?\s*[:=]\s*["']([^"'\s]{16,})["']/gi

/**
 * What kind of secret the text seems to hold, or null.
 *
 * Why the text is read as a whole: a secret can show in only one of the ways it is laid out.
 */
export function findCodeCompletionSecret(text: string): string | null {
  for (const { kind, pattern } of RULES) {
    if (pattern.test(text)) {
      return kind
    }
  }
  for (const match of text.matchAll(ASSIGNED_SECRET)) {
    if (!PLACEHOLDER.test(match[1])) {
      return 'secret assigned in code'
    }
  }
  return null
}

/**
 * What kind of secret the text around a cursor seems to hold, or null.
 *
 * Why two readings: the text is read with a line break at the cursor and without one, because a
 * secret can be cut by the cursor in either way — a key whose last line is below the cursor, and
 * a token the cursor sits inside.
 */
export function findCodeCompletionSecretAround(
  before: string,
  after: string,
  name = ''
): string | null {
  return (
    findCodeCompletionSecret(`${name}\n${before}\n${after}`) ??
    findCodeCompletionSecret(`${before}${after}`)
  )
}
