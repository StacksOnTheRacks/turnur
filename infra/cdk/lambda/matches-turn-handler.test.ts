import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEV_FIXTURE_GAME_ID } from '../lib/game-auth/constants';
import { DEV_FIXTURE_PLAINTEXT_SDK_KEY } from '../test-fixtures/dev-game-key';
import { handler } from './matches-turn-handler';

const GAME_TABLE_NAME = 'GameRegistryTest';
const MATCH_TABLE_NAME = 'MatchRegistryTest';
const STATE_TABLE_NAME = 'MatchStateTest';
const MATCH_ID = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
const MATCH_ID_B = 'bbbbbbbb-bbbb-4ccc-dddd-eeeeeeeeeeee';
const OTHER_GAME_ID = 'game_other_00000000000000000000000000000000';
const SEAT_ID_1 = '11111111-1111-4111-8111-111111111111';
const SEAT_ID_2 = '22222222-2222-4222-8222-222222222222';
const SEAT_ID_OTHER = '33333333-3333-4333-8333-333333333333';

function eventWithAuth(
  method: 'GET' | 'PUT',
  value: string | undefined,
  matchId: string = MATCH_ID,
  body?: string,
): APIGatewayProxyEventV2 {
  const headers = value === undefined ? {} : { authorization: value };
  return {
    routeKey: `${method} /v1/matches/{matchId}/turn`,
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

describe('matches-turn-handler', () => {
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

  it('GET before any designate returns currentSeat null', async () => {
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
    const body = responseBody(result!);
    expect(Object.keys(body)).toEqual(['currentSeat']);
    expect(body.currentSeat).toBeNull();
  });

  it('GET with seats present but no designate returns currentSeat null', async () => {
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
          seatOrder: [SEAT_ID_1, SEAT_ID_2],
        },
      });

    const result = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(200);
    expect(responseBody(result!)).toEqual({ currentSeat: null });
  });

  it('PUT designates first seat and GET reports same seat', async () => {
    let cursorCurrentSeat: string | null = null;
    const seatOrder = [SEAT_ID_1, SEAT_ID_2];

    send.mockImplementation(async (cmd) => {
      if (cmd instanceof GetCommand) {
        const key = cmd.input.Key;
        if (key?.keyHash !== undefined) {
          return { Item: { gameId: DEV_FIXTURE_GAME_ID } };
        }
        if (key?.matchId === MATCH_ID && key?.sk === undefined) {
          return { Item: { matchId: MATCH_ID, gameId: DEV_FIXTURE_GAME_ID } };
        }
        if (key?.sk === `SEAT#${SEAT_ID_1}`) {
          return {
            Item: {
              matchId: MATCH_ID,
              sk: `SEAT#${SEAT_ID_1}`,
              seatId: SEAT_ID_1,
              createdAt: '2026-08-27T12:00:00.000Z',
            },
          };
        }
        if (key?.sk === 'CURSOR') {
          return {
            Item: {
              matchId: MATCH_ID,
              sk: 'CURSOR',
              currentSeat: cursorCurrentSeat,
              seatOrder,
            },
          };
        }
      }
      if (cmd instanceof PutCommand) {
        const item = cmd.input.Item as { currentSeat?: string };
        cursorCurrentSeat = item.currentSeat ?? null;
      }
      return {};
    });

    const putResult = await handler(
      eventWithAuth(
        'PUT',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({ seatId: SEAT_ID_1 }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(putResult!)).toBe(200);
    const putBody = responseBody(putResult!);
    expect(Object.keys(putBody)).toEqual(['currentSeat']);
    expect(putBody.currentSeat).toBe(SEAT_ID_1);

    const getResult = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(getResult!)).toBe(200);
    expect(responseBody(getResult!)).toEqual({ currentSeat: SEAT_ID_1 });
  });

  it('PUT unknown seat returns 404 seat_not_found without changing currentSeat', async () => {
    send
      .mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, gameId: DEV_FIXTURE_GAME_ID },
      })
      .mockResolvedValueOnce({ Item: undefined });

    const putResult = await handler(
      eventWithAuth(
        'PUT',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({ seatId: SEAT_ID_OTHER }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(putResult!)).toBe(404);
    expect(responseBody(putResult!)).toMatchObject({ code: 'seat_not_found' });
    expect(send.mock.calls.some(([cmd]) => cmd instanceof PutCommand)).toBe(false);

    send
      .mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, gameId: DEV_FIXTURE_GAME_ID },
      })
      .mockResolvedValueOnce({
        Item: {
          matchId: MATCH_ID,
          sk: 'CURSOR',
          currentSeat: SEAT_ID_1,
          seatOrder: [SEAT_ID_1],
        },
      });

    const getResult = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(responseBody(getResult!)).toEqual({ currentSeat: SEAT_ID_1 });
  });

  it.each([
    ['missing body', undefined],
    ['empty body', ''],
    ['empty seatId', JSON.stringify({ seatId: '' })],
    ['whitespace seatId', JSON.stringify({ seatId: '   ' })],
    ['non-string seatId', JSON.stringify({ seatId: 123 })],
    ['unparseable JSON', '{not json}'],
  ])('PUT with %s returns 400 invalid_request', async (_label, body) => {
    send
      .mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID, gameId: DEV_FIXTURE_GAME_ID },
      });

    const result = await handler(
      eventWithAuth('PUT', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID, body),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(400);
    expect(responseBody(result!)).toMatchObject({ code: 'invalid_request' });
    expect(send.mock.calls.some(([cmd]) => cmd instanceof PutCommand)).toBe(false);
  });

  it('GET and PUT success bodies omit hidden-view and other fields', async () => {
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
          seatOrder: [SEAT_ID_1],
        },
      });

    const getResult = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(Object.keys(responseBody(getResult!))).toEqual(['currentSeat']);

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
          currentSeat: null,
          seatOrder: [SEAT_ID_1],
        },
      })
      .mockResolvedValueOnce({});

    const putResult = await handler(
      eventWithAuth(
        'PUT',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        JSON.stringify({ seatId: SEAT_ID_1 }),
      ),
      {} as never,
      () => {},
    );

    expect(Object.keys(responseBody(putResult!))).toEqual(['currentSeat']);
    expect(responseBody(putResult!)).not.toHaveProperty('view');
    expect(responseBody(putResult!)).not.toHaveProperty('seatOrder');
    expect(responseBody(putResult!)).not.toHaveProperty('payload');
  });

  it('returns 401 game_auth_required when Authorization is absent', async () => {
    const result = await handler(eventWithAuth('GET', undefined), {} as never, () => {});

    expect(statusCode(result!)).toBe(401);
    expect(responseBody(result!)).toMatchObject({ code: 'game_auth_required' });
    expect(send).not.toHaveBeenCalled();
  });

  it('returns 401 game_auth_invalid for an unknown SDK key', async () => {
    send.mockResolvedValueOnce({ Item: undefined });

    const result = await handler(
      eventWithAuth('GET', 'Bearer turnur_sk_11111111111111111111111111111111'),
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
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(404);
    expect(responseBody(result!)).toMatchObject({ code: 'match_not_found' });
    expect(send.mock.calls.some(([cmd]) => cmd.input?.Key?.sk === 'CURSOR')).toBe(false);
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
    expect(body).not.toHaveProperty('currentSeat');
    expect(send.mock.calls.some(([cmd]) => cmd.input?.Key?.sk === 'CURSOR')).toBe(false);
  });

  it('turn on match A does not appear on GET for match B', async () => {
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
      }
      return {};
    });

    const result = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID_B),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(200);
    expect(responseBody(result!)).toEqual({ currentSeat: null });
  });

  it('PUT on match B using match A seatId returns 404 seat_not_found', async () => {
    send
      .mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({
        Item: { matchId: MATCH_ID_B, gameId: DEV_FIXTURE_GAME_ID },
      })
      .mockResolvedValueOnce({ Item: undefined });

    const result = await handler(
      eventWithAuth(
        'PUT',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID_B,
        JSON.stringify({ seatId: SEAT_ID_1 }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(404);
    expect(responseBody(result!)).toMatchObject({ code: 'seat_not_found' });
  });
});
