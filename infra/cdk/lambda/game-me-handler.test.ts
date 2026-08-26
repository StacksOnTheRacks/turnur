import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEV_FIXTURE_GAME_ID } from '../lib/game-auth/constants';
import { DEV_FIXTURE_PLAINTEXT_SDK_KEY } from '../test-fixtures/dev-game-key';
import { handler } from './game-me-handler';

const TABLE_NAME = 'GameRegistryTest';

function eventWithAuth(value: string | undefined): APIGatewayProxyEventV2 {
  const headers = value === undefined ? {} : { authorization: value };
  return {
    routeKey: 'GET /v1/game/me',
    headers,
    requestContext: {
      http: { method: 'GET' },
    },
  } as APIGatewayProxyEventV2;
}

function responseBody(result: APIGatewayProxyResultV2): Record<string, unknown> {
  if (typeof result === 'string' || !result.body) {
    throw new Error('expected structured response');
  }
  return JSON.parse(result.body);
}

function statusCode(result: APIGatewayProxyResultV2): number {
  if (typeof result === 'string') {
    throw new Error('expected structured response');
  }
  return result.statusCode ?? 0;
}

describe('game-me-handler', () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    process.env.GAME_REGISTRY_TABLE_NAME = TABLE_NAME;
    vi.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({
      send,
    } as unknown as DynamoDBDocumentClient);
  });

  it('returns 200 with gameId for a valid dev-fixture SDK key', async () => {
    send.mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } });

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(200);
    expect(result).toMatchObject({
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    expect(responseBody(result!)).toEqual({ gameId: DEV_FIXTURE_GAME_ID });
    expect(JSON.stringify(responseBody(result!))).not.toContain('turnur_sk_');
    expect(send).toHaveBeenCalledWith(expect.any(GetCommand));
  });

  it('returns 401 game_auth_required when Authorization is absent', async () => {
    const result = await handler(eventWithAuth(undefined), {} as never, () => {});

    expect(statusCode(result!)).toBe(401);
    expect(responseBody(result!)).toMatchObject({ code: 'game_auth_required' });
    expect(send).not.toHaveBeenCalled();
  });

  it('returns 401 game_auth_invalid for an unknown SDK key', async () => {
    send.mockResolvedValueOnce({ Item: undefined });

    const result = await handler(
      eventWithAuth('Bearer turnur_sk_11111111111111111111111111111111'),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(401);
    expect(responseBody(result!)).toMatchObject({ code: 'game_auth_invalid' });
    expect(send).toHaveBeenCalledOnce();
  });
});
