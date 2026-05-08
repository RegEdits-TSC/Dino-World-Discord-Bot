# Security Policy

## Project Status

Dino-World is currently in **v1.0 beta** — active development, breaking
changes possible between minor versions, and the security model is still
maturing. Do not run a production instance with untrusted users on it
until v1.0 reaches a stable release.

## Supported Versions

Only the latest `1.0.x` release line receives security fixes during beta.
Older pre-release builds (snapshots, RCs, prior betas) are not supported —
upgrade to the latest tag before reporting an issue.

| Version       | Supported          |
| ------------- | ------------------ |
| 1.0.x (beta)  | :white_check_mark: |
| < 1.0         | :x:                |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security bugs.** Public
reports give attackers a head start on every existing deployment.

Instead, use **GitHub's private vulnerability reporting**:

1. Go to https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/security/advisories/new
2. Fill in a description, affected version, and reproduction steps
3. Submit — only repository maintainers will see it

### What to include

- Affected version (`/about` in Discord shows the running version)
- A clear description of the impact (what an attacker can do)
- Steps to reproduce, or a proof-of-concept if you have one
- Any logs, stack traces, or message IDs that help triage

### What to expect

Because this is a hobby/beta project, response times are best-effort:

- **Acknowledgement**: within 7 days
- **Initial assessment**: within 14 days
- **Fix or mitigation**: depends on severity — critical issues prioritized;
  lower-severity issues may be rolled into the next planned release

If you do not get an acknowledgement within 7 days, feel free to ping the
advisory thread.

## Scope

**In scope:**
- Authentication / authorization bypasses in bot commands
- Privilege escalation (e.g. a non-admin reaching admin-only actions)
- Data leakage (cross-guild data exposure, token leakage, log leakage of
  sensitive values)
- SQL injection, command injection, path traversal in user-controlled inputs
- Denial-of-service paths reachable by a single non-admin user
- Dependency vulnerabilities the bot is actually exposed to (please link
  the CVE and the affected code path)

**Out of scope (during beta):**
- Issues requiring physical access to the host
- Issues requiring an already-compromised Discord bot token
- Self-XSS or social-engineering attacks
- Rate-limit bypasses against Discord itself (report those to Discord)
- Findings from automated scanners with no demonstrated impact
- Missing best-practice headers/configs on optional debug endpoints

## Disclosure

After a fix is released, the advisory will be published with credit to
the reporter (unless anonymity is requested). Embargo length is decided
case-by-case based on severity and deployment footprint, but typically
will not exceed 30 days from a working fix being available.

Thanks for helping keep Dino-World safe during beta.
