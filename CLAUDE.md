# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Homey app that integrates Google Home/Nest devices via the Starling Home Hub — a local-network bridge exposing device state through a REST API. Built with TypeScript on Homey SDK v3, targeting local-only execution (no cloud). Supports 22 device drivers across lighting, climate, security, sensors, and more.

## Build & Development Commands

```bash
npm run build            # Clean + compile TypeScript + copy assets to .homeybuild/
npm run build:watch      # Watch mode (tsc --watch only, no asset copy)
npm run lint             # ESLint on src/
npm run lint:fix         # ESLint with auto-fix
npm run typecheck        # tsc --noEmit
npm test                 # Jest (all tests)
npm run test:watch       # Jest watch mode
npm run test:coverage    # Jest with coverage report
```

The `preversion` hook runs `lint → typecheck → test` before version bumps.

Build output goes to `.homeybuild/` — this directory is the Homey deploy artifact. The `postbuild` script copies `app.json`, `settings/`, `assets/`, and driver JSON/pair/assets into it.

## Architecture

### Entry Points

- **`src/app.ts`** — Main `StarlingHomeHubApp` class. Initializes HubManager, HubDiscovery, and registers all Flow Cards (triggers, conditions, actions). Singleton access point for drivers.
- **`src/api.ts`** — REST API handlers for the settings page (hub CRUD, diagnostics, discovery scan). Called from `settings/index.html` via `Homey.api()`.

### Core Library (`src/lib/`)

**`hub/`** — Hub connection lifecycle:
- `HubManager` — Singleton orchestrator managing multiple `HubConnection` instances, device routing, settings persistence, and event aggregation.
- `HubConnection` — Single hub connection: HTTP/HTTPS client, permission checking, device state caching.
- `Poller` — Non-overlapping interval-based poller (default 5s). Emits events on state changes.

**`api/`** — Starling Hub API v2 client:
- `StarlingClient` — HTTP client with auth, timeouts, TLS handling, and rate limiting.
- `types.ts` — Device interfaces for all 23 device categories.
- `errors.ts` — Custom error hierarchy.

**`drivers/`** — Base classes for all device drivers:
- `StarlingDriver` — Pairing flow: hub selection → device category filter → device list → zone suggestion from room names.
- `StarlingDevice` — State sync, optimistic updates with 15s rollback timeout, capability mapping, availability management, flow trigger emission.

**`discovery/`** — mDNS-based hub discovery with port probing (3080/3443) and TLS detection.

**`utils/`** — Logger (debug mode toggle) and RateLimiter.

### Device Drivers (`src/drivers/`)

22 drivers, each following the same pattern:
```
src/drivers/{type}/
  ├── driver.ts      # extends StarlingDriver, defines getDeviceCategory()
  └── device.ts      # extends StarlingDevice, implements registerCapabilityListeners() + mapStateToCapabilities()
```

Each driver:
1. Overrides `getDeviceCategory()` to return its Starling device category
2. Registers capability listeners that convert Homey values → Starling API properties (e.g., Homey dim 0-1 → Starling brightness 0-100)
3. Implements `mapStateToCapabilities()` to convert Starling state → Homey capabilities on each poll

### Homey Compose (`/.homeycompose/`)

Source-of-truth for Homey configuration — `app.json` at project root is auto-generated from `.homeycompose/app.json` plus driver compose files. Driver-specific compose:
- `.homeycompose/drivers/{type}/driver.compose.json` — capabilities, pair views, icons
- `.homeycompose/drivers/{type}/driver.flow.compose.json` — flow card definitions
- `.homeycompose/capabilities/` — custom capability definitions
- `.homeycompose/flow/` — global flow card definitions

### State Synchronization Flow

```
Poller (5s interval)
  → HubConnection fetches all device states
  → Detects changes against cached state
  → Emits deviceStateChange events
  → StarlingDevice.mapStateToCapabilities() updates Homey capabilities
  → Flow triggers fire on capability changes
```

### Optimistic Updates

When a user sends a command (e.g., toggle light), the device immediately updates the Homey capability, sends the API request, and sets a 15-second rollback timeout. If the next poll confirms the change, the timeout clears. If not confirmed within 15s, the capability rolls back to its previous value.

## TypeScript Configuration

- **Strict mode** fully enabled (`strict`, `noImplicitAny`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`)
- **Target:** ES2020 / CommonJS
- **Path aliases:** `@lib/*` → `src/lib/*`, `@drivers/*` → `src/drivers/*` (mirrored in `jest.config.js`)

## Testing

- Jest with ts-jest, manual Homey SDK mock at `__mocks__/homey.ts`
- Tests colocated in `__tests__/` directories alongside source
- Setup file: `src/__tests__/setup.ts`

## Linting

- ESLint with `@typescript-eslint/recommended-requiring-type-checking`
- Floating promises, misused promises, and await-thenable are errors
- Unused vars with `_` prefix are allowed
- Console usage produces warnings
- Test files are excluded from linting
