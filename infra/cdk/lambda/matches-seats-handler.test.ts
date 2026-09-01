import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEV_FIXTURE_GAME_ID } from '../lib/game-auth/constants';
import { DEV_FIXTURE_PLAINTEXT_SDK_KEY } from '../test-fixtures/dev-game-key';
import { handler } from './matches-seats-handler';

const GAME_TABLE_NAME = 'GameRegistryTest';
const MATCH_TABLE_NAME = 'MatchRegistryTest';
const STATE_TABLE_NAME = 'MatchStateTest';
const MATCH_ID = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
const MATCH_ID_B = 'bbbbbbbb-bbbb-4ccc-dddd-eeeeeeeeeeee';
const OTHER_GAME_ID = 'game_other_00000000000000000000000000000000';
const SEAT_ID_CLIENT = 'cccccccc-cccc-4ccc-dddd-eeeeeeeeeeee';

function eventWithAuth(
  method: 'GET' | 'POST',
  value: string | undefined,
  matchId: string = MATCH_ID,
  body?: string,
): APIGatewayProxyEventV2 {
  const headers = value === undefined ? {} : { authorization: value };
  return {
    routeKey: `${method} /v1/matches/{matchId}/seats`,
    headers,
    pathParameters: { matchId },
    body,
    requestContext: {
      http: { method },
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

function mockAuthAndOwnership(gameId: string = DEV_FIXTURE_GAME_ID, matchId: string = MATCH_ID) {
  return [
    { Item: { gameId: DEV_FIXTURE_GAME_ID } },
    {
      Item: {
        matchId,
        gameId,
        status: 'created',
        createdAt: '2026-08-27T12:00:00.000Z',
      },
    },
  ];
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('matches-seats-handler', () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    process.env.GAME_REGISTRY_TABLE_NAME = GAME_TABLE_NAME;
    process.env.MATCH_REGISTRY_TABLE_NAME = MATCH_TABLE_NAME;
    process.env.MATCH_STATE_TABLE_NAME = STATE_TABLE_NAME;
    vi.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({
      send,
    } as unknown as DynamoDBDocumentClient);
  });

  it('POST returns 201 with server UUID seatId and currentSeat null', async () => {
    send
      .mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, gameId: DEV_FIXTURE_GAME_ID },
      })
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const result = await handler(
      eventWithAuth('POST', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(201);
    const body = responseBody(result!);
    expect(Object.keys(body)).toEqual(['seatId', 'currentSeat']);
    expect(body.currentSeat).toBeNull();
    expect(body.seatId).toMatch(UUID_V4_PATTERN);
    expect(body.seatId).not.toBe(SEAT_ID_CLIENT);

    const putCalls = send.mock.calls.filter(([cmd]) => cmd instanceof PutCommand);
    expect(putCalls).toHaveLength(2);
    const seatPut = putCalls[0][0].input;
    expect(seatPut.Item).toEqual(
      expect.objectContaining({
        matchId: MATCH_ID,
        sk: `SEAT#${body.seatId}`,
        seatId: body.seatId,
      }),
    );
    expect(seatPut.Item).not.toHaveProperty('playerId');
    expect(seatPut.Item).not.toHaveProperty('userId');

    const cursorPut = putCalls[1][0].input;
    expect(cursorPut.Item).toEqual(
      expect.objectContaining({
        matchId: MATCH_ID,
        sk: 'CURSOR',
        currentSeat: null,
        seatOrder: [body.seatId],
      }),
    );
  });

  it('POST ignores client-supplied seatId and player identity in body', async () => {
    send
      .mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, gameId: DEV_FIXTURE_GAME_ID },
      })
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const result = await handler(
      eventWithAuth(
        'POST',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({
          seatId: SEAT_ID_CLIENT,
          playerId: 'player-1',
          userId: 'user-1',
          name: 'Alice',
          email: 'alice@example.com',
          sub: 'auth0|123',
        }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(201);
    const body = responseBody(result!);
    expect(body.seatId).not.toBe(SEAT_ID_CLIENT);

    const seatPut = send.mock.calls.find(([cmd]) => cmd instanceof PutCommand)?.[0].input;
    expect(seatPut?.Item).not.toHaveProperty('playerId');
    expect(seatPut?.Item).not.toHaveProperty('userId');
    expect(seatPut?.Item).not.toHaveProperty('name');
    expect(seatPut?.Item).not.toHaveProperty('email');
    expect(seatPut?.Item).not.toHaveProperty('sub');
  });

  it('two POSTs return distinct seatIds; GET lists both in creation order', async () => {
    const createdAt1 = '2026-08-27T12:00:01.000Z';
    const createdAt2 = '2026-08-27T12:00:02.000Z';
    const storedSeatIds: string[] = [];

    send.mockImplementation(async (cmd) => {
      if (cmd instanceof GetCommand) {
        const key = cmd.input.Key;
        if (key?.keyHash !== undefined) {
          return { Item: { gameId: DEV_FIXTURE_GAME_ID } };
        }
        if (key?.matchId === MATCH_ID && key?.sk === undefined) {
          return { Item: { matchId: MATCH_ID, gameId: DEV_FIXTURE_GAME_ID } };
        }
        if (key?.sk === 'CURSOR') {
          if (storedSeatIds.length === 0) {
            return { Item: undefined };
          }
          return {
            Item: {
              matchId: MATCH_ID,
              sk: 'CURSOR',
              currentSeat: null,
              seatOrder: [...storedSeatIds],
            },
          };
        }
        const seatIndex = storedSeatIds.findIndex((id) => key?.sk === `SEAT#${id}`);
        if (seatIndex >= 0) {
          const seatId = storedSeatIds[seatIndex];
          return {
            Item: {
              matchId: MATCH_ID,
              sk: `SEAT#${seatId}`,
              seatId,
              createdAt: seatIndex === 0 ? createdAt1 : createdAt2,
            },
          };
        }
      }
      if (cmd instanceof PutCommand) {
        const item = cmd.input.Item as { sk?: string; seatId?: string };
        if (item.sk?.startsWith('SEAT#') && item.seatId) {
          storedSeatIds.push(String(item.seatId));
        }
      }
      return {};
    });

    const post1 = await handler(
      eventWithAuth('POST', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );
    const post2 = await handler(
      eventWithAuth('POST', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    const firstSeatId = String(responseBody(post1!).seatId);
    const secondSeatId = String(responseBody(post2!).seatId);
    expect(firstSeatId).toMatch(UUID_V4_PATTERN);
    expect(secondSeatId).toMatch(UUID_V4_PATTERN);
    expect(firstSeatId).not.toBe(secondSeatId);
    expect(responseBody(post1!).currentSeat).toBeNull();
    expect(responseBody(post2!).currentSeat).toBeNull();

    const list = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(list!)).toBe(200);
    const listBody = responseBody(list!);
    expect(Object.keys(listBody)).toEqual(['seats', 'currentSeat']);
    expect(listBody.currentSeat).toBeNull();
    expect(listBody.seats).toEqual([
      { seatId: firstSeatId, createdAt: createdAt1 },
      { seatId: secondSeatId, createdAt: createdAt2 },
    ]);
    expect(JSON.stringify(listBody)).not.toMatch(/view|hiddenView|playerId|userId/);
  });

  it('GET before any seat returns empty roster and currentSeat null', async () => {
    send
      .mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, gameId: DEV_FIXTURE_GAME_ID },
      })
      .mockResolvedValueOnce({ Item: undefined });

    const result = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(200);
    expect(responseBody(result!)).toEqual({ seats: [], currentSeat: null });
  });

  it('GET omits hidden-view fields even when VIEW# items exist', async () => {
    const seatId = '33333333-3333-4333-8333-333333333333';
    send
      .mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, gameId: DEV_FIXTURE_GAME_ID },
      })
      .mockResolvedValueOnce({
        Item: {
          matchId: MATCH_ID,
          sk: 'CURSOR',
          currentSeat: null,
          seatOrder: [seatId],
        },
      })
      .mockResolvedValueOnce({
        Item: {
          matchId: MATCH_ID,
          sk: `SEAT#${seatId}`,
          seatId,
          createdAt: '2026-08-27T12:00:00.000Z',
        },
      });

    const result = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(200);
    const body = responseBody(result!);
    expect(body).toEqual({
      seats: [{ seatId, createdAt: '2026-08-27T12:00:00.000Z' }],
      currentSeat: null,
    });
    expect(body).not.toHaveProperty('view');
    expect(body).not.toHaveProperty('views');
    expect(body).not.toHaveProperty('hiddenView');
    expect(body.seats[0]).not.toHaveProperty('view');

    const getCalls = send.mock.calls.filter(([cmd]) => cmd instanceof GetCommand);
    for (const [cmd] of getCalls) {
      const key = cmd.input.Key;
      expect(key?.sk ?? '').not.toMatch(/^VIEW#/);
    }
  });

  it('returns 401 game_auth_required when Authorization is absent', async () => {
    const result = await handler(eventWithAuth('POST', undefined), {} as never, () => {});

    expect(statusCode(result!)).toBe(401);
    expect(responseBody(result!)).toMatchObject({ code: 'game_auth_required' });
    expect(send).not.toHaveBeenCalled();
  });

  it('returns 401 game_auth_invalid for an unknown SDK key', async () => {
    send.mockResolvedValueOnce({ Item: undefined });

    const result = await handler(
      eventWithAuth('POST', 'Bearer turnur_sk_11111111111111111111111111111111'),
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
      eventWithAuth('POST', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(404);
    expect(responseBody(result!)).toMatchObject({ code: 'match_not_found' });
    expect(send).toHaveBeenCalledTimes(2);
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
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(403);
    const body = responseBody(result!);
    expect(body).toMatchObject({ code: 'match_forbidden' });
    expect(body).not.toHaveProperty('matchId');
    expect(body).not.toHaveProperty('seats');
    expect(body).not.toHaveProperty('currentSeat');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.some(([cmd]) => cmd.input?.Key?.sk === 'CURSOR')).toBe(false);
  });

  it('seats on match A do not appear on GET for match B', async () => {
    const seatIdA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    send.mockImplementation(async (cmd) => {
      if (cmd instanceof GetCommand) {
        const key = cmd.input.Key;
        if (key?.keyHash !== undefined) {
          return { Item: { gameId: DEV_FIXTURE_GAME_ID } };
        }
        if (key?.matchId === MATCH_ID_B && key?.sk === undefined) {
          return { Item: { matchId: MATCH_ID_B, gameId: DEV_FIXTURE_GAME_ID } };
        }
        if (key?.matchId === MATCH_ID_B && key?.sk === 'CURSOR') {
          return { Item: undefined };
        }
        if (key?.matchId === MATCH_ID && key?.sk === `SEAT#${seatIdA}`) {
          throw new Error('should not query match A seats from match B GET');
        }
      }
      return {};
    });

    const result = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID_B),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(200);
    expect(responseBody(result!)).toEqual({ seats: [], currentSeat: null });
  });
});
