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

## Deploy

There is one environment: **`TurnurApiStack`**. Pushes to `main` that change `infra/cdk/**` (or this workflow) run synth and tests, then `cdk deploy TurnurApiStack`. Pull requests never deploy.

GitHub Actions assumes the role in repository variable **`AWS_DEPLOY_ROLE_ARN`** via OIDC. Optional **`AWS_REGION`** defaults to `us-east-1`. Set those on the repo (Settings → Secrets and variables → Actions → Variables). Prefer OIDC over long-lived access keys.

IAM trust (`sts:AssumeRoleWithWebIdentity`) should restrict:

- Issuer: `token.actions.githubusercontent.com`
- Audience (`aud`): `sts.amazonaws.com`
- Subject (`sub`): `repo:StacksOnTheRacks/turnur:ref:refs/heads/main`

The role needs CDK deploy permissions for this stack (CloudFormation, S3 bootstrap assets, IAM pass-through, Lambda, API Gateway HTTP, DynamoDB, CloudWatch Logs). Bootstrap the target account/region once (`npx cdk bootstrap`) before the first CI deploy.

After deploy, CI reads stack output **`HttpApiUrl`** and asserts `GET /v1/health` returns `{ "ok": true }`.

Local deploy (same stack):

```bash
npx cdk deploy TurnurApiStack --require-approval never
```

## HTTP API

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| `GET` | `/v1/health` | none (public liveness) | HTTP 200, `{ "ok": true }` |
| `GET` | `/v1/game/me` | `Authorization: Bearer` SDK key | HTTP 200, `{ "gameId": "<string>" }`; HTTP 401 structured error |
| `POST` | `/v1/matches` | `Authorization: Bearer` SDK key | HTTP 201, `{ "matchId": "<uuid>" }`; HTTP 401 structured error |
| `GET` | `/v1/matches/{matchId}` | `Authorization: Bearer` SDK key | HTTP 200, `{ "matchId", "status", "createdAt" }`; HTTP 401/403/404 structured error |
| `POST` | `/v1/matches/{matchId}/seats` | `Authorization: Bearer` SDK key | HTTP 201, `{ seatId, currentSeat }`; HTTP 401/403/404 structured error |
| `GET` | `/v1/matches/{matchId}/seats` | `Authorization: Bearer` SDK key | HTTP 200, `{ seats: [{ seatId, createdAt }], currentSeat }`; HTTP 401/403/404 structured error |
| `GET` | `/v1/matches/{matchId}/turn` | `Authorization: Bearer` SDK key | HTTP 200, `{ currentSeat }`; HTTP 401/403/404 structured error |
| `PUT` | `/v1/matches/{matchId}/turn` | `Authorization: Bearer` SDK key | HTTP 200, `{ currentSeat }`; HTTP 400/401/403/404 structured error |
| `POST` | `/v1/matches/{matchId}/moves` | `Authorization: Bearer` SDK key | HTTP 201, `{ seq, seatId, createdAt, currentSeat }`; HTTP 400/401/403/404/409 structured error |
| `PUT` | `/v1/matches/{matchId}/seats/{seatId}/view` | `Authorization: Bearer` SDK key | HTTP 200, `{ seatId }`; HTTP 400/401/403/404 structured error |
| `GET` | `/v1/matches/{matchId}/seats/{seatId}/view` | `Authorization: Bearer` SDK key | HTTP 200, `{ seatId, view }`; HTTP 401/403/404 structured error |
| `GET` | `/v1/matches/{matchId}/moves` | `Authorization: Bearer` SDK key | HTTP 200, `{ items: [{ seq, seatId, payload, createdAt }] }`; HTTP 401/403/404 structured error |

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

The following match-state capability is not available over HTTP yet:

- Signed result

For seats, turn designation, moves, hidden views, and the move log, see [Match authority onboarding](#match-authority-onboarding).

## Match authority onboarding

After [host attach onboarding](#host-attach-onboarding) confirms you can attach and probe a match, use Turnur as match-state authority for seats, turn designation, on-turn moves, seat-scoped hidden views, and the append-only move log. The path is:

1. **`POST /v1/matches/{matchId}/seats`** — create seats (server-issued `seatId`; no player identity).
2. **`GET /v1/matches/{matchId}/seats`** — list the public roster and `currentSeat`.
3. **`GET /v1/matches/{matchId}/turn`** / **`PUT /v1/matches/{matchId}/turn`** — read or designate `currentSeat`.
4. **`POST /v1/matches/{matchId}/moves`** — submit an on-turn move (appends to the log when accepted).
5. **`PUT /v1/matches/{matchId}/seats/{seatId}/view`** / **`GET .../view`** — write or read one seat's hidden view.
6. **`GET /v1/matches/{matchId}/moves`** — read the append-only move log.

Reuse `$TURNUR_BASE_URL`, `$TURNUR_SDK_KEY`, and `$TURNUR_MATCH_ID` from host attach. **Do not log, commit, or paste SDK keys into public channels.**

### Authentication model

**Turnur authenticates games, not players.** Match-authority routes identify your game server via SDK key only. Seats carry no player identity — your host maps each `seatId` to a player outside Turnur. Player identity, chat, rooms, media, and game rules stay on the host platform (RiffSync or any equivalent).

**Production SDK keys stay off player-facing game packs.** Keep keys on your game server or backend only. See [Authentication model](#authentication-model) under game auth onboarding for key format and header rules.

Send the SDK key on every protected request:

```http
Authorization: Bearer turnur_sk_<32 lowercase hex>
```

For **401** `game_auth_required` / `game_auth_invalid`, **403** `match_forbidden`, and **404** `match_not_found`, see [Auth errors (401)](#auth-errors-401) and [Match errors (403, 404)](#match-errors-403-404).

### Create seats

`POST /v1/matches/{matchId}/seats` has no request body. Turnur issues a server-generated `seatId`. Creating a seat does not designate a turn — `currentSeat` stays JSON `null` until you call `PUT /turn`.

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -X POST \
  -H "Authorization: Bearer $TURNUR_SDK_KEY" \
  "$TURNUR_BASE_URL/v1/matches/$TURNUR_MATCH_ID/seats"
```

Expected **201** response:

```json
{
  "seatId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "currentSeat": null
}
```

Save the returned `seatId` for turn designation, moves, and views. Run `POST` again to add more seats; each returns a distinct `seatId`.

### List seats

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Bearer $TURNUR_SDK_KEY" \
  "$TURNUR_BASE_URL/v1/matches/$TURNUR_MATCH_ID/seats"
```

Expected **200** response (after creating two seats):

```json
{
  "seats": [
    {
      "seatId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      "createdAt": "2026-08-27T12:00:00.000Z"
    },
    {
      "seatId": "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
      "createdAt": "2026-08-27T12:00:01.000Z"
    }
  ],
  "currentSeat": null
}
```

The roster lists `seatId` and `createdAt` only — no player identity and no hidden views. An empty match returns `{ "seats": [], "currentSeat": null }`, not 404.

### Current turn

Turnur does not auto-advance the turn after an accepted move and does not run game rules. **Your game designates `currentSeat`.** Extra-turn is `PUT` the same `seatId` again; pass is `PUT` a different seated `seatId`.

**Get current turn:**

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Bearer $TURNUR_SDK_KEY" \
  "$TURNUR_BASE_URL/v1/matches/$TURNUR_MATCH_ID/turn"
```

Expected **200** response when no seat is designated:

```json
{ "currentSeat": null }
```

**Designate turn** — substitute a `seatId` from create/list:

```bash
export TURNUR_SEAT_ID="6ba7b810-9dad-11d1-80b4-00c04fd430c8"

curl -sS -w "\nHTTP %{http_code}\n" \
  -X PUT \
  -H "Authorization: Bearer $TURNUR_SDK_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"seatId\":\"$TURNUR_SEAT_ID\"}" \
  "$TURNUR_BASE_URL/v1/matches/$TURNUR_MATCH_ID/turn"
```

Expected **200** response:

```json
{ "currentSeat": "6ba7b810-9dad-11d1-80b4-00c04fd430c8" }
```

### Submit a move

`POST /v1/matches/{matchId}/moves` accepts a move only when `seatId` equals `currentSeat`. An accepted move appends to the log and does **not** change `currentSeat`. A rejected move is not appended. `payload` is opaque JSON public to the owning game.

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -X POST \
  -H "Authorization: Bearer $TURNUR_SDK_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"seatId\":\"$TURNUR_SEAT_ID\",\"payload\":{\"opaque\":true}}" \
  "$TURNUR_BASE_URL/v1/matches/$TURNUR_MATCH_ID/moves"
```

Expected **201** response (note: no `payload` echo):

```json
{
  "seq": 1,
  "seatId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "createdAt": "2026-08-27T12:00:02.000Z",
  "currentSeat": "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
}
```

After accept, designate the next seat with `PUT /turn` when your game rules say the turn passes.

### Hidden views

Hidden views are seat-scoped. Put private or per-seat state in views, not in the move log. Shared reads (`GET` seats, `GET` turn, `GET` match probe, `GET /moves`) omit hidden views.

**Write a view:**

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -X PUT \
  -H "Authorization: Bearer $TURNUR_SDK_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"view\":{\"hand\":[\"card-a\",\"card-b\"]}}" \
  "$TURNUR_BASE_URL/v1/matches/$TURNUR_MATCH_ID/seats/$TURNUR_SEAT_ID/view"
```

Expected **200** response (note: no `view` echo):

```json
{ "seatId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8" }
```

**Read a view** — returns only that seat's view:

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Bearer $TURNUR_SDK_KEY" \
  "$TURNUR_BASE_URL/v1/matches/$TURNUR_MATCH_ID/seats/$TURNUR_SEAT_ID/view"
```

Expected **200** response:

```json
{
  "seatId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "view": { "hand": ["card-a", "card-b"] }
}
```

If no view has been written, `view` is JSON `null`.

### Move log

`GET /v1/matches/{matchId}/moves` returns the append-only log of accepted moves for the owning game. Each item includes `payload`. There is no `PUT`, `PATCH`, or `DELETE` on `/moves`.

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Bearer $TURNUR_SDK_KEY" \
  "$TURNUR_BASE_URL/v1/matches/$TURNUR_MATCH_ID/moves"
```

Expected **200** response:

```json
{
  "items": [
    {
      "seq": 1,
      "seatId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      "payload": { "opaque": true },
      "createdAt": "2026-08-27T12:00:02.000Z"
    }
  ]
}
```

An empty log is `{ "items": [] }`, not 404. Rejected moves (for example **409** `illegal_turn`) never appear in `items`.

### Authority errors (400, 404, 409)

Match-authority routes return the same structured JSON shape as auth and match errors (`code`, `message`, `hint`).

| `code` | HTTP | When |
| --- | --- | --- |
| `invalid_request` | 400 | Missing or invalid request body field |
| `seat_not_found` | 404 | `seatId` does not exist on this match |
| `illegal_turn` | 409 | `currentSeat` is null, or `seatId` is not `currentSeat` on move submit |

For moves, checks run in order: invalid request → seat not found → illegal turn.

**400 — invalid request** — omit required fields on move submit:

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -X POST \
  -H "Authorization: Bearer $TURNUR_SDK_KEY" \
  -H "Content-Type: application/json" \
  -d "{}" \
  "$TURNUR_BASE_URL/v1/matches/$TURNUR_MATCH_ID/moves"
```

Example **400** body:

```json
{
  "code": "invalid_request",
  "message": "Invalid request",
  "hint": "Provide seatId and payload in the request body."
}
```

**404 — seat not found** — designate or move for an unknown seat:

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -X PUT \
  -H "Authorization: Bearer $TURNUR_SDK_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"seatId\":\"00000000-0000-4000-8000-000000000000\"}" \
  "$TURNUR_BASE_URL/v1/matches/$TURNUR_MATCH_ID/turn"
```

Example **404** body:

```json
{
  "code": "seat_not_found",
  "message": "Seat not found",
  "hint": "Create the seat via POST /v1/matches/{matchId}/seats before designating it or submitting a move."
}
```

**409 — illegal turn** — submit a move when no seat is current, or for a seat that is not `currentSeat`:

```bash
curl -sS -w "\nHTTP %{http_code}\n" \
  -X POST \
  -H "Authorization: Bearer $TURNUR_SDK_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"seatId\":\"$TURNUR_SEAT_ID\",\"payload\":{\"opaque\":true}}" \
  "$TURNUR_BASE_URL/v1/matches/$TURNUR_MATCH_ID/moves"
```

Example **409** body (when `currentSeat` is null or does not match `seatId`):

```json
{
  "code": "illegal_turn",
  "message": "Illegal turn",
  "hint": "Submit a move only for the current seat. Designate a seat with PUT /v1/matches/{matchId}/turn first if none is current."
}
```

### Dev stack fixture (non-production)

> **NON-PRODUCTION ONLY.** Use the dev fixture key from [game auth onboarding](#dev-stack-fixture-non-production) with a `$TURNUR_MATCH_ID` from host attach. Run the create-seat → designate → move → view → list-moves sequence against a dev deploy.

### TypeScript SDK (optional)

When [`packages/turnur-sdk/`](../../packages/turnur-sdk/) is available, match authority uses the same client as attach and probe:

```typescript
import { createTurnurClient, TurnurApiError } from '@turnur/sdk';

const client = createTurnurClient({
  baseUrl: process.env.TURNUR_BASE_URL!,
  apiKey: process.env.TURNUR_SDK_KEY!,
});

const { matchId } = await client.match.create();
const { seatId } = await client.match.seat.create(matchId);
const roster = await client.match.seat.list(matchId);

await client.match.turn.set(matchId, seatId);
const { currentSeat } = await client.match.turn.get(matchId);

const move = await client.match.move.create(matchId, {
  seatId,
  payload: { opaque: true },
});

await client.match.view.put(matchId, seatId, { hand: ['card-a'] });
const hidden = await client.match.view.get(matchId, seatId);
const log = await client.match.moves.list(matchId);
```

On **400**, **401**, **403**, **404**, or **409**, the client throws `TurnurApiError` with structured `code`, `message`, and `hint`. Do not log `apiKey` or hidden-view payloads.

### Not yet implemented

The following are not available in this slice:

- Signed result
- Player or host authentication (callers remain game SDK key only)
- Chat, rooms, or media (stay on the host)
- A game-rule engine (Turnur stores state; your game designates turns and evaluates rules)

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
