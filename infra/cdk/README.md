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

The health route confirms the control-plane Lambda and API Gateway wiring are present. It does not check downstream dependencies (DynamoDB, Cognito, etc.).

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
