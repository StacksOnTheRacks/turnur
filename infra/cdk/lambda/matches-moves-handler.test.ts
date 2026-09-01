import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEV_FIXTURE_GAME_ID } from '../lib/game-auth/constants';
import { DEV_FIXTURE_PLAINTEXT_SDK_KEY } from '../test-fixtures/dev-game-key';
import { handler } from './matches-moves-handler';

const GAME_TABLE_NAME = 'GameRegistryTest';
const MATCH_TABLE_NAME = 'MatchRegistryTest';
const STATE_TABLE_NAME = 'MatchStateTest';
const MOVE_LOG_TABLE_NAME = 'MatchMoveLogTest';
const MATCH_ID = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
const MATCH_ID_B = 'bbbbbbbb-bbbb-4ccc-dddd-eeeeeeeeeeee';
const OTHER_GAME_ID = 'game_other_00000000000000000000000000000000';
const SEAT_ID_1 = '11111111-1111-4111-8111-111111111111';
const SEAT_ID_2 = '22222222-2222-4222-8222-222222222222';
const SEAT_ID_OTHER = '33333333-3333-4333-8333-333333333333';

function eventWithAuth(
  value: string | undefined,
  matchId: string = MATCH_ID,
  body?: string,
): APIGatewayProxyEventV2 {
  const headers = value === undefined ? {} : { authorization: value };
  return {
    routeKey: 'POST /v1/matches/{matchId}/moves',
    headers,
    pathParameters: { matchId },
    body,
    requestContext: {
      http: { method: 'POST' },
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

describe('matches-moves-handler', () => {
  const send = vi.fn();

  function mockAuthAndOwnershipCalls(matchId: string = MATCH_ID): void {
    send
      .mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({
        Item: { matchId, gameId: DEV_FIXTURE_GAME_ID },
      });
  }

  beforeEach(() => {
    send.mockReset();
    process.env.GAME_REGISTRY_TABLE_NAME = GAME_TABLE_NAME;
    process.env.MATCH_REGISTRY_TABLE_NAME = MATCH_TABLE_NAME;
    process.env.MATCH_STATE_TABLE_NAME = STATE_TABLE_NAME;
    process.env.MATCH_MOVE_LOG_TABLE_NAME = MOVE_LOG_TABLE_NAME;
    vi.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({
      send,
    } as unknown as DynamoDBDocumentClient);
  });

  it('POST on-turn move returns 201 with seq 1 and unchanged currentSeat', async () => {
    const payload = { action: 'would-be-illegal-under-game-rules', value: 99 };

    send
      .mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, gameId: DEV_FIXTURE_GAME_ID },
      })
      .mockResolvedValueOnce({
        Item: {
          matchId: MATCH_ID,
          sk: `SEAT#${SEAT_ID_1}`,
          seatId: SEAT_ID_1,
        },
      })
      .mockResolvedValueOnce({
        Item: {
          matchId: MATCH_ID,
          sk: 'CURSOR',
          currentSeat: SEAT_ID_1,
          seatOrder: [SEAT_ID_1, SEAT_ID_2],
        },
      })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    const result = await handler(
      eventWithAuth(
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({ seatId: SEAT_ID_1, payload }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(201);
    const body = responseBody(result!);
    expect(Object.keys(body)).toEqual(['seq', 'seatId', 'createdAt', 'currentSeat']);
    expect(body.seq).toBe(1);
    expect(typeof body.seq).toBe('number');
    expect(body.seatId).toBe(SEAT_ID_1);
    expect(body.currentSeat).toBe(SEAT_ID_1);
    expect(body).not.toHaveProperty('payload');

    const putCall = send.mock.calls.find(([cmd]) => cmd instanceof PutCommand);
    expect(putCall).toBeDefined();
    expect(putCall![0].input.Item).toMatchObject({
      matchId: MATCH_ID,
      seq: 1,
      seatId: SEAT_ID_1,
      payload,
    });
    expect(putCall![0].input.ConditionExpression).toBe('attribute_not_exists(seq)');
  });

  it('accepts payload {} when on-turn', async () => {
    mockAuthAndOwnershipCalls();
    send
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: `SEAT#${SEAT_ID_1}`, seatId: SEAT_ID_1 },
      })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: 'CURSOR', currentSeat: SEAT_ID_1 },
      })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    const result = await handler(
      eventWithAuth(
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({ seatId: SEAT_ID_1, payload: {} }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(201);
    const putCall = send.mock.calls.find(([cmd]) => cmd instanceof PutCommand);
    expect(putCall![0].input.Item?.payload).toEqual({});
  });

  it('second on-turn POST without intervening PUT returns seq 2', async () => {
    mockAuthAndOwnershipCalls();
    send
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: `SEAT#${SEAT_ID_1}`, seatId: SEAT_ID_1 },
      })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: 'CURSOR', currentSeat: SEAT_ID_1 },
      })
      .mockResolvedValueOnce({ Items: [{ seq: 1, seatId: SEAT_ID_1 }] })
      .mockResolvedValueOnce({});

    const result = await handler(
      eventWithAuth(
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({ seatId: SEAT_ID_1, payload: { turn: 2 } }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(201);
    const body = responseBody(result!);
    expect(body.seq).toBe(2);
    expect(body.currentSeat).toBe(SEAT_ID_1);
  });

  it('off-turn POST returns 409 illegal_turn without MoveLog PutItem', async () => {
    mockAuthAndOwnershipCalls();
    send
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: `SEAT#${SEAT_ID_2}`, seatId: SEAT_ID_2 },
      })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: 'CURSOR', currentSeat: SEAT_ID_1 },
      });

    const result = await handler(
      eventWithAuth(
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({ seatId: SEAT_ID_2, payload: { action: 'off-turn' } }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(409);
    expect(responseBody(result!)).toMatchObject({ code: 'illegal_turn' });
    expect(send.mock.calls.some(([cmd]) => cmd instanceof PutCommand)).toBe(false);
    expect(send.mock.calls.some(([cmd]) => cmd instanceof QueryCommand)).toBe(false);
  });

  it('following on-turn POST after rejected off-turn uses next unused seq', async () => {
    mockAuthAndOwnershipCalls();
    send
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: `SEAT#${SEAT_ID_1}`, seatId: SEAT_ID_1 },
      })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: 'CURSOR', currentSeat: SEAT_ID_1 },
      })
      .mockResolvedValueOnce({ Items: [{ seq: 1 }] })
      .mockResolvedValueOnce({});

    const result = await handler(
      eventWithAuth(
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({ seatId: SEAT_ID_1, payload: { action: 'valid' } }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(201);
    expect(responseBody(result!).seq).toBe(2);
  });

  it('POST without designate returns 409 illegal_turn', async () => {
    mockAuthAndOwnershipCalls();
    send
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: `SEAT#${SEAT_ID_1}`, seatId: SEAT_ID_1 },
      })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: 'CURSOR', currentSeat: null },
      });

    const result = await handler(
      eventWithAuth(
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({ seatId: SEAT_ID_1, payload: { action: 'early' } }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(409);
    expect(responseBody(result!)).toMatchObject({ code: 'illegal_turn' });
    expect(send.mock.calls.some(([cmd]) => cmd instanceof PutCommand)).toBe(false);
  });

  it('ConditionalCheckFailedException returns 409 illegal_turn', async () => {
    mockAuthAndOwnershipCalls();
    send
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: `SEAT#${SEAT_ID_1}`, seatId: SEAT_ID_1 },
      })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: 'CURSOR', currentSeat: SEAT_ID_1 },
      })
      .mockResolvedValueOnce({ Items: [] })
      .mockRejectedValueOnce(new ConditionalCheckFailedException({ message: 'race', $metadata: {} }));

    const result = await handler(
      eventWithAuth(
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({ seatId: SEAT_ID_1, payload: { action: 'race' } }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(409);
    expect(responseBody(result!)).toMatchObject({ code: 'illegal_turn' });
  });

  it('POST with invalid body fields returns 400 invalid_request', async () => {
    const invalidBodies = [
      undefined,
      JSON.stringify({ payload: { x: 1 } }),
      JSON.stringify({ seatId: SEAT_ID_1 }),
      JSON.stringify({ seatId: SEAT_ID_1, payload: null }),
      JSON.stringify({ seatId: '', payload: { x: 1 } }),
      JSON.stringify({ seatId: 123, payload: { x: 1 } }),
    ];

    for (const body of invalidBodies) {
      send.mockReset();
      vi.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({
        send,
      } as unknown as DynamoDBDocumentClient);
      mockAuthAndOwnershipCalls();

      const result = await handler(
        eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID, body),
        {} as never,
        () => {},
      );

      expect(statusCode(result!)).toBe(400);
      expect(responseBody(result!)).toMatchObject({ code: 'invalid_request' });
      expect(send.mock.calls.some(([cmd]) => cmd instanceof PutCommand)).toBe(false);
    }
  });

  it('POST for unknown seat returns 404 seat_not_found even when currentSeat is null', async () => {
    mockAuthAndOwnershipCalls();
    send
      .mockResolvedValueOnce({ Item: undefined });

    const result = await handler(
      eventWithAuth(
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({ seatId: SEAT_ID_OTHER, payload: { x: 1 } }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(404);
    expect(responseBody(result!)).toMatchObject({ code: 'seat_not_found' });
    expect(send.mock.calls.some(([cmd]) => cmd instanceof PutCommand)).toBe(false);
  });

  it('POST 201 keys omit view and payload echo', async () => {
    mockAuthAndOwnershipCalls();
    send
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: `SEAT#${SEAT_ID_1}`, seatId: SEAT_ID_1 },
      })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: 'CURSOR', currentSeat: SEAT_ID_1 },
      })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    const result = await handler(
      eventWithAuth(
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({ seatId: SEAT_ID_1, payload: { secret: 'view-data' } }),
      ),
      {} as never,
      () => {},
    );

    const body = responseBody(result!);
    expect(Object.keys(body)).toEqual(['seq', 'seatId', 'createdAt', 'currentSeat']);
    expect(body).not.toHaveProperty('payload');
    expect(body).not.toHaveProperty('view');
  });

  it('does not PutItem MatchState on accept', async () => {
    mockAuthAndOwnershipCalls();
    send
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: `SEAT#${SEAT_ID_1}`, seatId: SEAT_ID_1 },
      })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: 'CURSOR', currentSeat: SEAT_ID_1 },
      })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    await handler(
      eventWithAuth(
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({ seatId: SEAT_ID_1, payload: { x: 1 } }),
      ),
      {} as never,
      () => {},
    );

    const putCalls = send.mock.calls.filter(([cmd]) => cmd instanceof PutCommand);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0][0].input.TableName).toBe(MOVE_LOG_TABLE_NAME);
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
    send
      .mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({ Item: undefined });

    const result = await handler(
      eventWithAuth(
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({ seatId: SEAT_ID_1, payload: { x: 1 } }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(404);
    expect(responseBody(result!)).toMatchObject({ code: 'match_not_found' });
    expect(send.mock.calls.some(([cmd]) => cmd instanceof PutCommand)).toBe(false);
  });

  it('returns 403 match_forbidden when match belongs to another game', async () => {
    send
      .mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({
        Item: {
          matchId: MATCH_ID,
          gameId: OTHER_GAME_ID,
          status: 'created',
          createdAt: '2026-08-27T12:00:00.000Z',
        },
      });

    const result = await handler(
      eventWithAuth(
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({ seatId: SEAT_ID_1, payload: { x: 1 } }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(403);
    const body = responseBody(result!);
    expect(body).toMatchObject({ code: 'match_forbidden' });
    expect(body).not.toHaveProperty('matchId');
    expect(body).not.toHaveProperty('seq');
    expect(send.mock.calls.some(([cmd]) => cmd instanceof PutCommand)).toBe(false);
  });

  it('moves on match B do not use match A seatId', async () => {
    send
      .mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID_B, gameId: DEV_FIXTURE_GAME_ID },
      })
      .mockResolvedValueOnce({ Item: undefined });

    const result = await handler(
      eventWithAuth(
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID_B,
        JSON.stringify({ seatId: SEAT_ID_1, payload: { x: 1 } }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(404);
    expect(responseBody(result!)).toMatchObject({ code: 'seat_not_found' });
  });

  it('first on-turn accept on match B returns seq 1', async () => {
    const seatB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    send
      .mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID_B, gameId: DEV_FIXTURE_GAME_ID },
      })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID_B, sk: `SEAT#${seatB}`, seatId: seatB },
      })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID_B, sk: 'CURSOR', currentSeat: seatB },
      })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    const result = await handler(
      eventWithAuth(
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID_B,
        JSON.stringify({ seatId: seatB, payload: { first: true } }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(201);
    expect(responseBody(result!).seq).toBe(1);
    const putCall = send.mock.calls.find(([cmd]) => cmd instanceof PutCommand);
    expect(putCall![0].input.Item?.matchId).toBe(MATCH_ID_B);
  });

  it('Query uses ScanIndexForward false and Limit 1', async () => {
    mockAuthAndOwnershipCalls();
    send
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: `SEAT#${SEAT_ID_1}`, seatId: SEAT_ID_1 },
      })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, sk: 'CURSOR', currentSeat: SEAT_ID_1 },
      })
      .mockResolvedValueOnce({ Items: [{ seq: 5 }] })
      .mockResolvedValueOnce({});

    const result = await handler(
      eventWithAuth(
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({ seatId: SEAT_ID_1, payload: { x: 1 } }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(201);
    expect(responseBody(result!).seq).toBe(6);

    const queryCall = send.mock.calls.find(([cmd]) => cmd instanceof QueryCommand);
    expect(queryCall).toBeDefined();
    expect(queryCall![0].input.ScanIndexForward).toBe(false);
    expect(queryCall![0].input.Limit).toBe(1);
  });
});
