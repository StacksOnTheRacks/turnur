# Turnur AWS CDK (`infra/cdk`)

AWS CDK **v2** (TypeScript) workspace for Turnur infrastructure. This package defines **`TurnurApiStack`**: an API Gateway HTTP API (v2) and a Node 22 Lambda wired to **`GET /v1/health`**.

## Prerequisites

- **Node.js 22** or newer (`engines.node` is `>=22`)
- npm (lockfile committed for reproducible installs)

## Setup

From the repository root:

```bash
cd infra/cdk
npm ci
```

## Verify

These commands should all exit 0 after setup:

```bash
npm run build
npm test
npm run synth
```

- **`npm run build`** - compiles TypeScript under `bin/` and `lib/` to `dist/`
- **`npm test`** - runs Vitest handler and stack assertions
- **`npm run synth`** - emits CloudFormation templates under `cdk.out/` (no AWS credentials required)

## HTTP API

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| `GET` | `/v1/health` | none (public liveness) | HTTP 200, `{ "ok": true }` |
| `GET` | `/v1/game/me` | `Authorization: Bearer` SDK key | HTTP 200, `{ "gameId": "<string>" }`; HTTP 401 structured error |

The health route confirms the control-plane Lambda and API Gateway wiring are present. It does not check downstream dependencies (DynamoDB, Cognito, etc.).

## Game authentication onboarding

Integrators can verify Turnur is reachable and that an SDK key is configured without reading source code. The path is:

1. **`GET /v1/health`** — confirm the API is up (no auth).
2. **Obtain and configure an SDK key** — store it in your runtime environment (for example `TURNUR_SDK_KEY`). Turnur does not yet expose key provisioning APIs; use the key issued for your game registration.
3. **`GET /v1/game/me`** — authenticated probe that returns the stable `gameId` for your key.

Set placeholders before running the examples below:

```bash
export TURNUR_BASE_URL="https://your-turnur-api.example.com"   # no trailing slash
export TURNUR_SDK_KEY="turnur_sk_your32hexcharactershere000000" # your integrator key
```

**Do not log, commit, or paste SDK keys into public channels.** Use environment variables or a secrets manager in production.

### Authentication model

**Turnur authenticates games, not players.** Your game server presents an SDK key to identify itself to Turnur. Player identity, chat, rooms, and media stay on the host platform (RiffSync or any equivalent).

SDK keys follow **ADR-002**: `turnur_sk_` plus exactly **32 lowercase hex characters**.

Send the key on every protected request:

```http
Authorization: Bearer turnur_sk_<32 lowercase hex>
```

Do not pass SDK keys in query strings or request bodies.

### Health check (unauthenticated)

```bash
curl -sS "$TURNUR_BASE_URL/v1/health"
```

Expected **200** response:

```json
{ "ok": true }
```

### Authenticated probe

```bash
curl -sS \
  -H "Authorization: Bearer $TURNUR_SDK_KEY" \
  "$TURNUR_BASE_URL/v1/game/me"
```

Expected **200** response:

```json
{ "gameId": "your-game-id" }
```

### Auth errors (401)

Protected routes return structured JSON on failure:

```json
{ "code": "<string>", "message": "<string>", "hint": "<string>" }
```

| `code` | When |
| --- | --- |
| `game_auth_required` | `Authorization` header is missing |
| `game_auth_invalid` | Header present but token is malformed, unknown, or not registered |

**Missing header** — omit `Authorization`:

```bash
curl -sS -w "\nHTTP %{http_code}\n" "$TURNUR_BASE_URL/v1/game/me"
```

Example **401** body:

```json
{
  "code": "game_auth_required",
  "message": "Game SDK key required",
  "hint": "Send Authorization: Bearer <sdk-key> with a valid turnur_sk_ key."
}
```

**Invalid key** — malformed or unregistered token:

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Bearer turnur_sk_ffffffffffffffffffffffffffffffff" \
  "$TURNUR_BASE_URL/v1/game/me"
```

Example **401** body:

```json
{
  "code": "game_auth_invalid",
  "message": "Invalid game SDK key",
  "hint": "Check the Authorization Bearer token format and that the key is registered."
}
```

### Dev stack fixture (non-production)

> **NON-PRODUCTION ONLY.** The dev CDK stack seeds a test fixture key for local verification. Never use this key outside dev/test environments.

| Plaintext key | Registered `gameId` |
| --- | --- |
| `turnur_sk_00000000000000000000000000000000` | `dev-fixture` |

After deploying a dev stack, you can probe with:

```bash
export TURNUR_SDK_KEY="turnur_sk_00000000000000000000000000000000"
curl -sS -H "Authorization: Bearer $TURNUR_SDK_KEY" "$TURNUR_BASE_URL/v1/game/me"
# => { "gameId": "dev-fixture" }
```

### TypeScript SDK (optional)

When [`packages/turnur-sdk/`](../../packages/turnur-sdk/) is available, the same probe is:

```typescript
import { createTurnurClient } from '@turnur/sdk';

const client = createTurnurClient({
  baseUrl: process.env.TURNUR_BASE_URL!,
  apiKey: process.env.TURNUR_SDK_KEY!,
});

const { gameId } = await client.game.me();
console.log(gameId);
```

On **401**, the client throws an error with the structured `code`, `message`, and `hint` fields.

### Not yet implemented

The following match-engine capabilities are not available over HTTP yet:

- Host attach
- Seats
- Turns
- Hidden views
- Move log
- Signed result

Documenting them here sets expectations only; there are no routes for these flows today.

## Layout

| Path | Role |
| --- | --- |
| `bin/turnur.ts` | CDK app entry; instantiates `TurnurApiStack` |
| `lib/turnur-api-stack.ts` | HTTP API (v2) + health `NodejsFunction` + route wiring |
| `lib/turnur-api-stack.test.ts` | Vitest template assertions |
| `lambda/health-handler.ts` | `GET /v1/health` Lambda handler |
| `lambda/health-handler.test.ts` | Vitest handler contract tests |

## Runtime note

Turnur targets **Node.js 22** for Lambda runtimes (see project ADR-001). Run the CDK app locally on Node 22 as well.
