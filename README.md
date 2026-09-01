# Turnur

Authoritative turn-based match engine. Hosts attach a match; Turnur owns seats, turns, hidden views, the move log, and a signed result.

Identity, chat, rooms, and media stay on the host platform (RiffSync or anything like it).

## Infrastructure

AWS CDK workspace lives under [`infra/cdk/`](infra/cdk/README.md). See that README for Node 22 setup and verify commands (`npm ci`, `npm run build`, `npm test`, `npm run synth`).

For game SDK key setup and verification (`GET /v1/health` → configure key → `GET /v1/game/me`), see [Game authentication onboarding](infra/cdk/README.md#game-authentication-onboarding) in the CDK README.

For attaching and probing matches (`GET /v1/game/me` → `POST /v1/matches` → `GET /v1/matches/{matchId}`), see [Host attach onboarding](infra/cdk/README.md#host-attach-onboarding) in the CDK README.

For match-state authority (seats, turn designation, moves, hidden views, move log), see [Match authority onboarding](infra/cdk/README.md#match-authority-onboarding) in the CDK README.
