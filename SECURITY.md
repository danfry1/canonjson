# Security Policy

## Reporting a vulnerability

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/danfry1/canonjson/security/advisories/new).
Please do not open a public issue for a security report.

Expect an acknowledgement within 72 hours and an assessment within seven days.

## Supported versions

The latest minor release receives security fixes.

## Scope

canonjson has no dependencies and performs no I/O beyond the optional CLI reading
a file or stdin. The security-relevant guarantees are:

- **Determinism.** The same input value always produces the same bytes. A
  divergence between this implementation and another RFC 8785 implementation is
  a security bug when the output is signed — please report it.
- **Bounded work on hostile input.** Nesting is capped by `maxDepth` (default
  1000) so a deeply nested payload cannot exhaust the stack. Raising `maxDepth`
  beyond roughly 2000 trades that guarantee for depth.
- **Rejection of non-interoperable input.** `NaN`, `Infinity`, and unpaired
  surrogates throw rather than producing bytes another implementation would
  reject or interpret differently.

Note that `hash()` is a plain digest, not a MAC: it authenticates nothing on its
own. `quickHash()` is non-cryptographic and must not be used where collision
resistance matters.

## Supply chain

Releases are published from GitHub Actions with npm provenance. Dependencies are
exact-pinned, lifecycle scripts are disabled, and CI actions are pinned to commit
SHAs.
