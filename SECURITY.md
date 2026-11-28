# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/latte-lattice-3d/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the static Latte Lattice 3D browser diorama, deterministic geometry engine, scene diagnostics, share state and OBJ or STL export.

In scope:

- A cross-site scripting or HTML injection path through scene state, lattice parameters, share links, imported text or generated output.
- A geometry serialization, OBJ, STL or report export flaw that bypasses validation or executes attacker-controlled content when opened.
- A WebGL or browser rendering boundary flaw that allows attacker-controlled script execution in the application origin.
- A browser-storage or offline-runtime flaw that serves attacker-controlled application code across an update.
- A validation failure that presents malformed geometry, diagnostics or export integrity checks as verified.

Out of scope:

- Browser vulnerabilities, operating system compromise or physical access to the machine.
- Damage caused by modified copies of the static application that do not come from this repository.
- Documented approximation limits of engineering or geometry models, unless a report shows a specific validation or output integrity failure.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
