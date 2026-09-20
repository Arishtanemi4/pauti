# Changelog

All notable changes to Pauti are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Platform support is tracked as a matrix line on each release, never encoded in the version
number** — one version describes one feature set across every target it has been verified on.
See [ADR-011](docs/architecture.md).

Key: `✓` verified · `—` not yet built · `partial` builds with known gaps.

## [Unreleased]

Platforms: Android ✓ | iOS — | Web —

Work towards v0.1.0, tracked phase by phase in [`docs/plan/EXECUTE.md`](docs/plan/EXECUTE.md).

### Added

- Architecture decision records covering the local-first design ([`docs/architecture.md`](docs/architecture.md)).
- Build plan for v0.1.0 ([`docs/plan/EXECUTE.md`](docs/plan/EXECUTE.md)).

### Changed

- `.gitignore` rewritten. The previous `*docs*` pattern matched any path containing "docs" and
  silently excluded the entire documentation tree; real receipts and bank statements are now
  named explicitly instead of being shielded by accident.

[Unreleased]: https://github.com/Arishtanemi4/pauti/compare/v0.1.0...HEAD
