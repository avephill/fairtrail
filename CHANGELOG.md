# Changelog

## [0.3.1] - 2026-03-14

### Added
- `--backend` and `--model` CLI flags to select AI provider per session
- Multi-destination parsing: "Bogota or Medellin" creates separate route searches
- CLI demo GIF and Headless CLI section in README

### Fixed
- Multi-route flight selection now tracks all routes (via `_routeIdx` tagging)
- `--tmux` inside tmux splits into new panes instead of sending to own running pane
- `--tmux` works with single-route queries (no split, just view)
- Chart flicker eliminated by memoizing expensive renders (countdown ticks don't redraw chart)
- CLI providers (claude-code, codex) no longer require API key env vars
- Commander import fixed for Linux CI typecheck
- Docker PORT env var no longer leaks into container

## [0.3.0] - 2026-03-13

### Added
- **Headless CLI TUI** (`--headless`) — full terminal interface for flight price tracking using Ink 6 (React for terminals)
  - Interactive search wizard: natural language query, LLM parse, Playwright scrape, flight selection, DB tracking
  - `--headless --list` — navigable table of all tracked queries with status, prices, last scraped time
  - `--headless --view <id>` — live price chart with Unicode braille rendering, auto-refresh every 30s with countdown bar, per-airline colored trend lines
  - `--headless --view <id> --tmux` — opens isolated tmux session in new Ghostty window with one pane per grouped route
- **`packages/cli/` workspace** — new monorepo package sharing scraper libs from `apps/web/` via custom Node.js ESM alias loader
- **Braille chart renderer** — Unicode braille characters (2x4 dot grid) with Bresenham line drawing, dynamic Y-axis scaling, rolling time window
- Without `--headless`, `--view` opens the web browser and `--list` opens the admin dashboard
- 28 unit tests for chart renderer and formatters, plus E2E test script

### Fixed
- Chart dynamically adapts to tmux pane dimensions on resize

### Changed
- Root `npm run cli` now implies `--headless` for terminal usage
- CI lint and typecheck now include the CLI workspace

## [0.2.3] - 2026-03-13

### Fixed
- Codex CLI `--print` error — codex does not support `--print` (Claude Code flag); now uses `codex exec` for non-interactive extraction ([#1](https://github.com/affromero/fairtrail/issues/1) — thanks @bobvmierlo)
- CLI checksum verification removed — was blocking installs when the CLI script changed between releases
- Both Claude Code and Codex CLIs now install unconditionally in the container (no env var gating needed)
- Telegram deploy notifications no longer fire on cancelled CI runs

### Changed
- README updated: full CLI help output, explains why `~/.claude` and `~/.codex` are mounted read-only, CLI providers show as auto-detected

## [0.2.2] - 2026-03-13

### Fixed
- `fairtrail: command not found` on Ubuntu — installer now auto-patches shell profile to add `~/.local/bin` to PATH ([#1](https://github.com/affromero/fairtrail/issues/1) — thanks @bobvmierlo)
- `spawn codex ENOENT` in Docker — entrypoint installs CLI providers (codex, claude) inside the container when enabled, persisted via `cli-cache` volume ([#1](https://github.com/affromero/fairtrail/issues/1))
- `xdg-open` error spam on headless Linux — guarded behind `DISPLAY`/`WAYLAND_DISPLAY` check ([#1](https://github.com/affromero/fairtrail/issues/1))
- Install one-liner changed from `| sh` to `| bash` — the script uses bash-specific syntax that breaks under dash (Ubuntu default `sh`)
- Codex CLI spawn now passes `env` to child process (was missing, unlike claude-code)
- Actionable ENOENT error messages for CLI providers instead of raw stack traces

### Added
- Tests for CLI provider detection, ENOENT handling, and installer shell script correctness (18 new tests)

## [0.2.1] - 2026-03-09

### Added
- "What Fairtrail is not" section on landing page
- System theme detection with demo GIF swap for light/dark modes
- Behavioral test suite (110 tests across 14 files)
- Cron scheduling jitter (±2.5min) to avoid bot detection

### Fixed
- Docker multi-arch manifest so `fairtrail update` works on Apple Silicon (arm64)
- Docker image slimmed from 1GB to 475MB
- Pin Prisma@6 in entrypoint and deploy to avoid v7 breaking changes
- POSIX shell compatibility for installer (replace `echo -e` with `printf`)
- Mount `~/.claude.json` config in installer for Claude Code CLI users

### Changed
- CI cancels in-progress deploys when a new push arrives

## [0.2.0] - 2026-03-08

### Added
- OS detection in installer with Docker install guidance for Linux and WSL
- Port conflict check during install with interactive port selection
- Browser auto-open when starting Fairtrail via CLI
- `fairtrail version` command showing version and git commit SHA
- Commit SHA exposed in `/api/version` endpoint for build traceability
- "Why self-hosted?" section on landing page
- PNG favicon and Apple touch icon for cross-browser support

### Changed
- Self-hosted instances skip admin password setup — go straight to provider selection
- Install script shows security-relevant commands before executing

## [0.1.0] - 2026-03-08

### Added
- Natural language flight search powered by LLM (Anthropic, OpenAI, Google AI)
- Automated price tracking via Google Flights scraping (Playwright + headless Chromium)
- Interactive Plotly.js price evolution charts with airline colors and click-to-book
- Self-hosted Docker installer (`curl -fsSL https://fairtrail.org/install.sh | sh`)
- `fairtrail` CLI for managing self-hosted instances (start, stop, logs, search)
- Multi-currency support with locale auto-detection
- Multiple travel date support with date grouping in charts
- Price drop alerts on home page
- Share links, CSV export, and price calendar on chart pages
- Community route sharing between self-hosted instances
- Explore page with seed routes and popular destinations
- Admin dashboard with query management, LLM config, and cost tracking
- PWA support with auto-update banner
- Configurable scrape interval (default 3h)
- GitHub Actions CI/CD with Docker image publishing to GHCR
