# Turnur AWS CDK (`infra/cdk`)

AWS CDK **v2** (TypeScript) workspace for Turnur infrastructure. This package defines **`TurnurApiStack`**: an API Gateway HTTP API (v2) and a Node 22 stub Lambda ready for route wiring in [#3](https://github.com/StacksOnTheRacks/turnur/issues/3).

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
- **`npm test`** - runs Vitest stack assertions (HTTP API + Lambda present; no routes yet)
- **`npm run synth`** - emits CloudFormation templates under `cdk.out/` (no AWS credentials required)

## Layout

| Path | Role |
| --- | --- |
| `bin/turnur.ts` | CDK app entry; instantiates `TurnurApiStack` |
| `lib/turnur-api-stack.ts` | HTTP API (v2) + stub `NodejsFunction` (routes arrive in #3) |
| `lib/turnur-api-stack.test.ts` | Vitest template assertions |
| `lambda/stub-handler.ts` | Placeholder Lambda handler (not the `/v1/health` contract) |

## Runtime note

Turnur targets **Node.js 22** for Lambda runtimes (see project ADR-001). Run the CDK app locally on Node 22 as well.
