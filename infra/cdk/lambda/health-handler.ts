/**
 * GET /v1/health — unauthenticated liveness check.
 *
 * Stable success response (v1): HTTP 200, body `{ "ok": true }` only.
 * No service name, version, or timestamp in this contract.
 */
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

export type HealthResponseBody = { ok: true };

export const handler: APIGatewayProxyHandlerV2 = async () => {
  const body: HealthResponseBody = { ok: true };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
};
