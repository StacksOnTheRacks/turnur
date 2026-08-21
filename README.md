# Turnur

Authoritative turn-based match engine. Hosts attach a match; Turnur owns seats, turns, hidden views, the move log, and a signed result.

Identity, chat, rooms, and media stay on the host platform (RiffSync or anything like it).

## Infrastructure

AWS CDK workspace lives under [`infra/cdk/`](infra/cdk/README.md). See that README for Node 22 setup and verify commands (`npm ci`, `npm run build`, `npm test`, `npm run synth`).
