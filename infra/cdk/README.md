# Turnur AWS CDK (`infra/cdk`)

AWS CDK **v2** (TypeScript) workspace for Turnur infrastructure. This package currently defines a **placeholder stack** with zero AWS resources so later tickets can add the API stack, Lambda handlers, and CI without re-scaffolding.

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
- **`npm test`** - runs Vitest smoke tests (stack synthesizes cleanly)
- **`npm run synth`** - emits CloudFormation templates under `cdk.out/` (no AWS credentials required)

## Layout

| Path | Role |
| --- | --- |
| `bin/turnur.ts` | CDK app entry; instantiates `TurnurPlaceholderStack` |
| `lib/turnur-placeholder-stack.ts` | Minimal stack with zero AWS resources |
| `lib/turnur-placeholder-stack.test.ts` | Vitest smoke test |
| `lambda/` | Reserved for future Lambda handlers |

## Runtime note

Turnur targets **Node.js 22** for Lambda runtimes (see project ADR-001). Run the CDK app locally on Node 22 as well.
