import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';

import { handler } from './health-handler';

describe('health-handler', () => {
  it('returns 200 with { ok: true } and JSON content-type', async () => {
    const event = {
      routeKey: 'GET /v1/health',
      requestContext: {
        http: { method: 'GET' },
      },
    } as APIGatewayProxyEventV2;

    const result = await handler(event, {} as never, () => {});

    expect(result).toMatchObject({
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    expect(JSON.parse(result!.body!)).toEqual({ ok: true });
  });
});
