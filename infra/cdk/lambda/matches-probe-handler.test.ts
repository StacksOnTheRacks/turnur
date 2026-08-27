import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEV_FIXTURE_GAME_ID } from '../lib/game-auth/constants';
import { DEV_FIXTURE_PLAINTEXT_SDK_KEY } from '../test-fixtures/dev-game-key';
import { handler } from './matches-probe-handler';

const GAME_TABLE_NAME = 'GameRegistryTest';
const MATCH_TABLE_NAME = 'MatchRegistryTest';
const MATCH_ID = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
const OTHER_GAME_ID = 'game_other_00000000000000000000000000000000';

function eventWithAuth(
  value: string | undefined,
  matchId: string = MATCH_ID,
): APIGatewayProxyEventV2 {
  const headers = value === undefined ? {} : { authorization: value };
  return {
    routeKey: 'GET /v1/matches/{matchId}',
    headers,
    pathParameters: { matchId },
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

describe('matches-probe-handler', () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    process.env.GAME_REGISTRY_TABLE_NAME = GAME_TABLE_NAME;
    process.env.MATCH_REGISTRY_TABLE_NAME = MATCH_TABLE_NAME;
    vi.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({
      send,
    } as unknown as DynamoDBDocumentClient);
  });

  it('returns 200 with match metadata for a valid dev-fixture SDK key', async () => {
    send.mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } });
    send.mockResolvedValueOnce({
      Item: {
        matchId: MATCH_ID,
        gameId: DEV_FIXTURE_GAME_ID,
        status: 'created',
        createdAt: '2026-08-27T12:00:00.000Z',
      },
    });

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(200);
    expect(result).toMatchObject({
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    expect(responseBody(result!)).toEqual({
      matchId: MATCH_ID,
      status: 'created',
      createdAt: '2026-08-27T12:00:00.000Z',
    });
    expect(Object.keys(responseBody(result!))).toEqual(['matchId', 'status', 'createdAt']);
    expect(JSON.stringify(responseBody(result!))).not.toContain('turnur_sk_');
    expect(JSON.stringify(responseBody(result!))).not.toContain(DEV_FIXTURE_GAME_ID);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, expect.any(GetCommand));
    expect(send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: MATCH_TABLE_NAME,
          Key: { matchId: MATCH_ID },
        }),
      }),
    );
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

  it('returns 404 match_not_found when match item is absent', async () => {
    send.mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } });
    send.mockResolvedValueOnce({ Item: undefined });

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(404);
    expect(responseBody(result!)).toMatchObject({ code: 'match_not_found' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('returns 403 match_forbidden when match belongs to another game', async () => {
    send.mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } });
    send.mockResolvedValueOnce({
      Item: {
        matchId: MATCH_ID,
        gameId: OTHER_GAME_ID,
        status: 'created',
        createdAt: '2026-08-27T12:00:00.000Z',
      },
    });

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(403);
    const body = responseBody(result!);
    expect(body).toMatchObject({ code: 'match_forbidden' });
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('createdAt');
    expect(body).not.toHaveProperty('matchId');
    expect(send).toHaveBeenCalledTimes(2);
  });
});
