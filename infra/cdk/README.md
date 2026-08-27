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
| `POST` | `/v1/matches` | `Authorization: Bearer` SDK key | HTTP 201, `{ "matchId": "<uuid>" }`; HTTP 401 structured error |
| `GET` | `/v1/matches/{matchId}` | `Authorization: Bearer` SDK key | HTTP 200, `{ "matchId", "status", "createdAt" }`; HTTP 401/403/404 structured error |

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

## Host attach onboarding

After [game authentication onboarding](#game-authentication-onboarding) confirms your SDK key works, attach a match and read it back. The path is:

1. **`GET /v1/game/me`** — confirm your SDK key resolves to a `gameId` (prerequisite from game auth onboarding).
2. **`POST /v1/matches`** — attach (create) a new match; Turnur returns a server-generated `matchId`.
3. **`GET /v1/matches/{matchId}`** — probe the match you attached; confirm `status` and `createdAt`.

Reuse the same `$TURNUR_BASE_URL` and `$TURNUR_SDK_KEY` placeholders from game auth onboarding. **Do not log, commit, or paste SDK keys into public channels.**

### Authentication model

**Turnur authenticates games, not players.** Attach and probe routes identify your game server via SDK key only. Player identity, chat, rooms, and media stay on the host platform (RiffSync or any equivalent). See [Authentication model](#authentication-model) under game auth onboarding for key format and header rules.

`POST /v1/matches` requires no request body in v1; any body is ignored. Each successful POST creates a distinct match (no idempotency).

### Attach match

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -X POST \
  -H "Authorization: Bearer $TURNUR_SDK_KEY" \
  "$TURNUR_BASE_URL/v1/matches"
```

Expected **201** response:

```json
{ "matchId": "550e8400-e29b-41d4-a716-446655440000" }
```

Save the returned `matchId` for the get-match step below.

### Get match

Substitute the `matchId` from attach:

```bash
export TURNUR_MATCH_ID="550e8400-e29b-41d4-a716-446655440000"

curl -sS -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Bearer $TURNUR_SDK_KEY" \
  "$TURNUR_BASE_URL/v1/matches/$TURNUR_MATCH_ID"
```

Expected **200** response:

```json
{
  "matchId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "created",
  "createdAt": "2026-08-27T12:00:00.000Z"
}
```

Initial `status` is always `"created"` in v1. The response does not include `gameId` or other registry internals.

### Match errors (403, 404)

Match routes return the same structured JSON shape as auth errors (`code`, `message`, `hint`). Auth failures still use **401** with `game_auth_required` or `game_auth_invalid` (see [Auth errors (401)](#auth-errors-401)).

| `code` | HTTP | When |
| --- | --- | --- |
| `match_not_found` | 404 | `matchId` does not exist (including malformed path params) |
| `match_forbidden` | 403 | Match exists but belongs to a different game |

**404 — unknown match** — use a UUID that was never attached:

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Bearer $TURNUR_SDK_KEY" \
  "$TURNUR_BASE_URL/v1/matches/00000000-0000-4000-8000-000000000000"
```

Example **404** body:

```json
{
  "code": "match_not_found",
  "message": "Match not found",
  "hint": "Verify the matchId exists and was created via POST /v1/matches for your game."
}
```

**403 — wrong game** — probe a `matchId` created by another game's SDK key (error body only; no cross-game metadata):

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Bearer $TURNUR_SDK_KEY" \
  "$TURNUR_BASE_URL/v1/matches/<match-id-from-another-game>"
```

Example **403** body:

```json
{
  "code": "match_forbidden",
  "message": "Match belongs to another game",
  "hint": "Use the SDK key for the game that created this match."
}
```

### Dev stack fixture (non-production)

> **NON-PRODUCTION ONLY.** Use the dev fixture key from [game auth onboarding](#dev-stack-fixture-non-production) to attach and probe end-to-end after deploying a dev stack:

```bash
export TURNUR_SDK_KEY="turnur_sk_00000000000000000000000000000000"

# attach
curl -sS -X POST -H "Authorization: Bearer $TURNUR_SDK_KEY" "$TURNUR_BASE_URL/v1/matches"
# => { "matchId": "<uuid>" }

# get (substitute matchId from attach)
curl -sS -H "Authorization: Bearer $TURNUR_SDK_KEY" "$TURNUR_BASE_URL/v1/matches/<matchId>"
# => { "matchId": "<uuid>", "status": "created", "createdAt": "<iso8601>" }
```

### TypeScript SDK (optional)

When [`packages/turnur-sdk/`](../../packages/turnur-sdk/) is available, attach and probe are:

```typescript
import { createTurnurClient } from '@turnur/sdk';

const client = createTurnurClient({
  baseUrl: process.env.TURNUR_BASE_URL!,
  apiKey: process.env.TURNUR_SDK_KEY!,
});

const { matchId } = await client.match.create();
const match = await client.match.get(matchId);
console.log(match.status, match.createdAt);
```

On **401**, **403**, or **404**, the client throws an error with the structured `code`, `message`, and `hint` fields.

### Not yet implemented

The following match-state capabilities are not available over HTTP yet:

- Seats
- Turns
- Hidden views
- Move log
- Signed result

Documenting them here sets expectations only; attach and probe are the only match routes in v1.

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
