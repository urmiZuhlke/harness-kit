/**
 * redact.mjs — the credential shapes the kit looks for, and the one function that masks them.
 *
 * Kept apart from repo.mjs because the participant-side history collector is bundled into a
 * single file and must redact prompt excerpts without dragging the whole repo harvester in.
 * A prompt is exactly where a pasted key ends up ("here's my key, why does this 401?"), and
 * the history file is committed to a repository that may be pushed somewhere public.
 */

/**
 * Secret patterns. Every match is reported by file and line with the value masked —
 * the point is to tell a team they leaked something, never to reproduce it.
 */
export const SECRET_PATTERNS = [
  { name: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/, alwaysReal: true },
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, alwaysReal: true },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, alwaysReal: true },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, alwaysReal: true },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/, alwaysReal: true },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}\b/, alwaysReal: true },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./, alwaysReal: true },
  // These two match shapes, not issuers, so where they appear decides what they mean.
  { name: 'connection-string-password', re: /\b[a-z+]{2,12}:\/\/[^\s:@/]+:[^\s:@/]{4,}@/i },
  {
    name: 'assigned-credential',
    re: /\b(?:api[_-]?key|secret|password|passwd|token|client[_-]?secret)\b\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
  },
];

/**
 * Global versions of the detection patterns. The originals are non-global because they
 * only ever answer "does this line match"; replacing every occurrence needs the `g` flag.
 */
const SECRET_PATTERNS_GLOBAL = SECRET_PATTERNS.map(({ name, re }) => ({
  name,
  re: new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'),
}));

/** Replace anything that looks like a credential with a named marker. */
export function redactSecrets(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const { name, re } of SECRET_PATTERNS_GLOBAL) {
    re.lastIndex = 0;
    out = out.replace(re, '[redacted: ' + name + ']');
  }
  return out;
}
