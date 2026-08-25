---
description: 'Use as a checklist for every PR and whenever touching auth, secrets, CORS, or API surface. Covers JWT validation, secrets management, CORS policy, input validation, and rate limiting.'
applyTo: '**'
---

# Security Instructions

Read this file as a checklist for **every PR** and whenever touching auth, secrets,
CORS, or API surface.

---

## Auth Checklist

- [ ] JWT validation uses `jwks-rsa` with `cache: true` and `rateLimit: true`. Signing
      keys are never hardcoded.
- [ ] Token audience (`aud`) is validated against the app's client ID.
- [ ] Token issuer (`iss`) is validated against the identity provider's issuer URL.
- [ ] Algorithm is pinned to `RS256` — symmetric algorithms (`HS256`) are not accepted.
- [ ] Every new endpoint explicitly decides its auth status: protected (default) or `@Public()`.
- [ ] `@Public()` is only applied to genuinely public endpoints (`/health`, webhooks with
      their own verification).
- [ ] `@CurrentUser()` is used to access the authenticated user — never raw headers or
      query params for identity.

---

## Secrets Management Rules

- All secrets are passed via **environment variables**. Never hardcode credentials, keys,
  or tokens.
- `.env` files are gitignored. Only `.env.example` (with placeholder values) is committed.
- Cloud secrets are stored in the platform's secret manager (e.g. Key Vault, Secrets Manager, Secret Manager) and injected at
  runtime via app configuration.
- CI secrets are stored as repository/organization secrets and referenced as `${{ secrets.NAME }}`.
- **Never** log secret values — even at DEBUG level. `DATABASE_URL` contains credentials —
  never log it.

---

## CORS Policy

- Allowed origins are read from an env variable (comma-separated allowlist).
- Wildcards (`*`) are **never** permitted in production.
- With `credentials: true`, `origin` must be exact strings, not a wildcard.
- In dev, set the allowlist to the local frontend origin.

---

## API Security Checklist for PRs

**Input validation**

- [ ] All request bodies have a DTO with `class-validator` decorators.
- [ ] `ValidationPipe` is global with `whitelist: true` and `forbidNonWhitelisted: true`.
- [ ] Path/query params are annotated with appropriate types/validators.

**Output**

- [ ] Responses do not leak internal error messages (use framework exception classes).
- [ ] Database error messages are not forwarded to API responses.

**Authorization**

- [ ] User-scoped resources verify the caller's identity matches the resource owner.
- [ ] Admin-only endpoints have an explicit role/group check.

**Rate limiting**

- [ ] Throttler guard is active globally. High-sensitivity endpoints have tighter limits.

**Security headers**

- [ ] a security-headers middleware is registered — do not remove it.

**Dependencies**

- [ ] Run `npm audit` after adding new dependencies. Document accepted CVEs in the
      decision-records doc.
