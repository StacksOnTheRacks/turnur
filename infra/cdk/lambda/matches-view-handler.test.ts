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
import { handler as movesHandler } from './matches-moves-handler';
import { handler as probeHandler } from './matches-probe-handler';
import { handler as seatsHandler } from './matches-seats-handler';
import { handler as turnHandler } from './matches-turn-handler';
import { handler } from './matches-view-handler';

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
const VIEW_PAYLOAD_A = { cards: ['ace', 'king'], secret: true };
const VIEW_PAYLOAD_B = ['hidden', 'hand'];
const VIEW_PAYLOAD_A2 = { cards: ['two', 'three'] };

type StateStore = {
  seats: Set<string>;
  views: Map<string, unknown>;
  cursor: { currentSeat: string | null; seatOrder: string[] };
  moves: Array<{ seq: number; seatId: string; payload: unknown; createdAt: string }>;
};

function eventWithAuth(
  method: 'GET' | 'PUT',
  value: string | undefined,
  matchId: string = MATCH_ID,
  seatId: string = SEAT_ID_1,
  body?: string,
): APIGatewayProxyEventV2 {
  const headers = value === undefined ? {} : { authorization: value };
  return {
    routeKey: `${method} /v1/matches/{matchId}/seats/{seatId}/view`,
    headers,
    pathParameters: { matchId, seatId },
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

function createMockStore(initial?: Partial<StateStore>): StateStore {
  return {
    seats: new Set(initial?.seats ?? [SEAT_ID_1, SEAT_ID_2]),
    views: new Map(initial?.views ?? []),
    cursor: initial?.cursor ?? { currentSeat: null, seatOrder: [SEAT_ID_1, SEAT_ID_2] },
    moves: initial?.moves ?? [],
  };
}

function installMockSend(store: StateStore, matchId: string = MATCH_ID): ReturnType<typeof vi.fn> {
  const send = vi.fn(async (cmd) => {
    if (cmd instanceof GetCommand) {
      const key = cmd.input.Key;
      if (key?.keyHash !== undefined) {
        return { Item: { gameId: DEV_FIXTURE_GAME_ID } };
      }
      if (key?.matchId !== undefined && key?.sk === undefined) {
        if (key.matchId === matchId || key.matchId === MATCH_ID || key.matchId === MATCH_ID_B) {
          return { Item: { matchId: key.matchId, gameId: DEV_FIXTURE_GAME_ID } };
        }
        return { Item: undefined };
      }
      if (key?.sk === 'CURSOR') {
        return {
          Item: {
            matchId: key.matchId,
            sk: 'CURSOR',
            currentSeat: store.cursor.currentSeat,
            seatOrder: store.cursor.seatOrder,
          },
        };
      }
      if (typeof key?.sk === 'string' && key.sk.startsWith('SEAT#')) {
        const seatId = key.sk.slice('SEAT#'.length);
        if (store.seats.has(seatId)) {
          return {
            Item: {
              matchId: key.matchId,
              sk: key.sk,
              seatId,
              createdAt: '2026-08-27T12:00:00.000Z',
            },
          };
        }
        return { Item: undefined };
      }
      if (typeof key?.sk === 'string' && key.sk.startsWith('VIEW#')) {
        const seatId = key.sk.slice('VIEW#'.length);
        const view = store.views.get(seatId);
        if (view === undefined) {
          return { Item: undefined };
        }
        return {
          Item: {
            matchId: key.matchId,
            sk: key.sk,
            view,
          },
        };
      }
    }
    if (cmd instanceof QueryCommand) {
      const items = store.moves
        .filter((move) => move.seq !== undefined)
        .sort((a, b) => b.seq - a.seq)
        .slice(0, cmd.input.Limit ?? store.moves.length)
        .map((move) => ({
          matchId,
          seq: move.seq,
          seatId: move.seatId,
          payload: move.payload,
          createdAt: move.createdAt,
        }));
      return { Items: items, Count: items.length };
    }
    if (cmd instanceof PutCommand) {
      const item = cmd.input.Item as {
        matchId?: string;
        sk?: string;
        view?: unknown;
        currentSeat?: string | null;
        seatOrder?: string[];
        seq?: number;
        seatId?: string;
        payload?: unknown;
        createdAt?: string;
      };
      if (item.sk?.startsWith('VIEW#')) {
        const seatId = item.sk.slice('VIEW#'.length);
        store.views.set(seatId, item.view);
      }
      if (item.sk === 'CURSOR') {
        store.cursor.currentSeat = item.currentSeat ?? null;
        if (item.seatOrder) {
          store.cursor.seatOrder = item.seatOrder;
        }
      }
      if (item.seq !== undefined && cmd.input.TableName === MOVE_LOG_TABLE_NAME) {
        store.moves.push({
          seq: item.seq,
          seatId: String(item.seatId),
          payload: item.payload,
          createdAt: String(item.createdAt),
        });
      }
    }
    return {};
  });
  vi.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({
    send,
  } as unknown as DynamoDBDocumentClient);
  return send;
}

describe('matches-view-handler', () => {
  beforeEach(() => {
    process.env.GAME_REGISTRY_TABLE_NAME = GAME_TABLE_NAME;
    process.env.MATCH_REGISTRY_TABLE_NAME = MATCH_TABLE_NAME;
    process.env.MATCH_STATE_TABLE_NAME = STATE_TABLE_NAME;
    process.env.MATCH_MOVE_LOG_TABLE_NAME = MOVE_LOG_TABLE_NAME;
    vi.restoreAllMocks();
  });

  it('PUT then GET returns stored view for first seat', async () => {
    const store = createMockStore();
    installMockSend(store);

    const putResult = await handler(
      eventWithAuth(
        'PUT',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        SEAT_ID_1,
        JSON.stringify({ view: VIEW_PAYLOAD_A }),
      ),
      {} as never,
      () => {},
    );

    expect(statusCode(putResult!)).toBe(200);
    const putBody = responseBody(putResult!);
    expect(Object.keys(putBody)).toEqual(['seatId']);
    expect(putBody.seatId).toBe(SEAT_ID_1);
    expect(putBody).not.toHaveProperty('view');

    const getResult = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID, SEAT_ID_1),
      {} as never,
      () => {},
    );

    expect(statusCode(getResult!)).toBe(200);
    const getBody = responseBody(getResult!);
    expect(Object.keys(getBody)).toEqual(['seatId', 'view']);
    expect(getBody).toEqual({ seatId: SEAT_ID_1, view: VIEW_PAYLOAD_A });
  });

  it('GET before PUT and GET second seat after only first written return view null', async () => {
    const store = createMockStore();
    installMockSend(store);

    const getBefore = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID, SEAT_ID_1),
      {} as never,
      () => {},
    );

    expect(responseBody(getBefore!)).toEqual({ seatId: SEAT_ID_1, view: null });

    await handler(
      eventWithAuth(
        'PUT',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        SEAT_ID_1,
        JSON.stringify({ view: VIEW_PAYLOAD_A }),
      ),
      {} as never,
      () => {},
    );

    const getSecond = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID, SEAT_ID_2),
      {} as never,
      () => {},
    );

    expect(responseBody(getSecond!)).toEqual({ seatId: SEAT_ID_2, view: null });
  });

  it('GET each seat returns only that seat view with VIEW# GetItem isolation', async () => {
    const store = createMockStore();
    const send = installMockSend(store);

    await handler(
      eventWithAuth(
        'PUT',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        SEAT_ID_1,
        JSON.stringify({ view: VIEW_PAYLOAD_A }),
      ),
      {} as never,
      () => {},
    );

    await handler(
      eventWithAuth(
        'PUT',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        SEAT_ID_2,
        JSON.stringify({ view: VIEW_PAYLOAD_B }),
      ),
      {} as never,
      () => {},
    );

    send.mockClear();

    const getA = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID, SEAT_ID_1),
      {} as never,
      () => {},
    );

    expect(responseBody(getA!)).toEqual({ seatId: SEAT_ID_1, view: VIEW_PAYLOAD_A });
    expect(responseBody(getA!)).not.toHaveProperty('views');
    expect(JSON.stringify(responseBody(getA!))).not.toContain(SEAT_ID_2);

    const viewGetCalls = send.mock.calls.filter(
      ([cmd]) =>
        cmd instanceof GetCommand &&
        String(cmd.input.Key?.sk ?? '').startsWith('VIEW#'),
    );
    expect(viewGetCalls).toHaveLength(1);
    expect(viewGetCalls[0][0].input.Key).toEqual({
      matchId: MATCH_ID,
      sk: `VIEW#${SEAT_ID_1}`,
    });

    send.mockClear();

    await handler(
      eventWithAuth(
        'PUT',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        SEAT_ID_1,
        JSON.stringify({ view: VIEW_PAYLOAD_A2 }),
      ),
      {} as never,
      () => {},
    );

    const getB = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID, SEAT_ID_2),
      {} as never,
      () => {},
    );

    expect(responseBody(getB!)).toEqual({ seatId: SEAT_ID_2, view: VIEW_PAYLOAD_B });
  });

  it('second PUT replaces view fully', async () => {
    const store = createMockStore();
    installMockSend(store);

    await handler(
      eventWithAuth(
        'PUT',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        SEAT_ID_1,
        JSON.stringify({ view: VIEW_PAYLOAD_A }),
      ),
      {} as never,
      () => {},
    );

    await handler(
      eventWithAuth(
        'PUT',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        SEAT_ID_1,
        JSON.stringify({ view: VIEW_PAYLOAD_A2 }),
      ),
      {} as never,
      () => {},
    );

    const getResult = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID, SEAT_ID_1),
      {} as never,
      () => {},
    );

    expect(responseBody(getResult!)).toEqual({ seatId: SEAT_ID_1, view: VIEW_PAYLOAD_A2 });
  });

  it.each([
    ['empty object', { view: {} }, {}],
    ['array', { view: [] }, []],
    ['string', { view: '' }, ''],
    ['number zero', { view: 0 }, 0],
    ['boolean false', { view: false }, false],
  ])('accepts %s as opaque view', async (_label, body, expected) => {
    const store = createMockStore();
    installMockSend(store);

    await handler(
      eventWithAuth(
        'PUT',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        SEAT_ID_1,
        JSON.stringify(body),
      ),
      {} as never,
      () => {},
    );

    const getResult = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID, SEAT_ID_1),
      {} as never,
      () => {},
    );

    expect(responseBody(getResult!)).toEqual({ seatId: SEAT_ID_1, view: expected });
  });

  it.each([
    ['missing body', undefined],
    ['empty body', ''],
    ['null view', JSON.stringify({ view: null })],
    ['omitted view', JSON.stringify({})],
    ['unparseable JSON', '{not json}'],
    ['array body', JSON.stringify([{ view: {} }])],
  ])('PUT with %s returns 400 invalid_request without VIEW# write', async (_label, body) => {
    const store = createMockStore({ views: new Map([[SEAT_ID_1, VIEW_PAYLOAD_A]]) });
    const send = installMockSend(store);

    const result = await handler(
      eventWithAuth('PUT', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID, SEAT_ID_1, body),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(400);
    expect(responseBody(result!)).toMatchObject({ code: 'invalid_request' });
    expect(send.mock.calls.some(([cmd]) => cmd instanceof PutCommand)).toBe(false);

    const getResult = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID, SEAT_ID_1),
      {} as never,
      () => {},
    );

    expect(responseBody(getResult!)).toEqual({ seatId: SEAT_ID_1, view: VIEW_PAYLOAD_A });
  });

  it('ignores body seatId and extra fields on PUT', async () => {
    const store = createMockStore();
    installMockSend(store);

    await handler(
      eventWithAuth(
        'PUT',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        SEAT_ID_1,
        JSON.stringify({
          view: VIEW_PAYLOAD_A,
          seatId: SEAT_ID_2,
          playerId: 'p1',
          email: 'a@b.com',
        }),
      ),
      {} as never,
      () => {},
    );

    const getA = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID, SEAT_ID_1),
      {} as never,
      () => {},
    );
    const getB = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID, SEAT_ID_2),
      {} as never,
      () => {},
    );

    expect(responseBody(getA!)).toEqual({ seatId: SEAT_ID_1, view: VIEW_PAYLOAD_A });
    expect(responseBody(getB!)).toEqual({ seatId: SEAT_ID_2, view: null });
  });

  it('PUT and GET unknown seat return 404 seat_not_found without VIEW# write', async () => {
    const store = createMockStore();
    const send = installMockSend(store);

    for (const method of ['PUT', 'GET'] as const) {
      send.mockClear();
      const result = await handler(
        eventWithAuth(
          method,
          `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
          MATCH_ID,
          SEAT_ID_OTHER,
          method === 'PUT' ? JSON.stringify({ view: VIEW_PAYLOAD_A }) : undefined,
        ),
        {} as never,
        () => {},
      );

      expect(statusCode(result!)).toBe(404);
      expect(responseBody(result!)).toMatchObject({ code: 'seat_not_found' });
      expect(send.mock.calls.some(([cmd]) => cmd instanceof PutCommand)).toBe(false);
    }

    const getExisting = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID, SEAT_ID_1),
      {} as never,
      () => {},
    );
    expect(responseBody(getExisting!)).toEqual({ seatId: SEAT_ID_1, view: null });
  });

  it('shared reads omit hidden views after a view is written', async () => {
    const store = createMockStore();
    installMockSend(store);

    await handler(
      eventWithAuth(
        'PUT',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        SEAT_ID_1,
        JSON.stringify({ view: VIEW_PAYLOAD_A }),
      ),
      {} as never,
      () => {},
    );

    const seatsResult = await seatsHandler(
      {
        routeKey: 'GET /v1/matches/{matchId}/seats',
        headers: { authorization: `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}` },
        pathParameters: { matchId: MATCH_ID },
        requestContext: { http: { method: 'GET' } },
      } as APIGatewayProxyEventV2,
      {} as never,
      () => {},
    );

    const seatsBody = JSON.parse(String(seatsResult && typeof seatsResult !== 'string' ? seatsResult.body : ''));
    expect(seatsBody).not.toHaveProperty('view');
    expect(seatsBody).not.toHaveProperty('views');
    expect(seatsBody).not.toHaveProperty('hiddenView');
    expect(seatsBody.seats[0]).not.toHaveProperty('view');

    const turnResult = await turnHandler(
      {
        routeKey: 'GET /v1/matches/{matchId}/turn',
        headers: { authorization: `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}` },
        pathParameters: { matchId: MATCH_ID },
        requestContext: { http: { method: 'GET' } },
      } as APIGatewayProxyEventV2,
      {} as never,
      () => {},
    );

    const turnBody = JSON.parse(String(turnResult && typeof turnResult !== 'string' ? turnResult.body : ''));
    expect(Object.keys(turnBody)).toEqual(['currentSeat']);

    const probeResult = await probeHandler(
      {
        routeKey: 'GET /v1/matches/{matchId}',
        headers: { authorization: `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}` },
        pathParameters: { matchId: MATCH_ID },
        requestContext: { http: { method: 'GET' } },
      } as APIGatewayProxyEventV2,
      {} as never,
      () => {},
    );

    const probeBody = JSON.parse(String(probeResult && typeof probeResult !== 'string' ? probeResult.body : ''));
    expect(Object.keys(probeBody)).toEqual(['matchId', 'status', 'createdAt']);
    expect(probeBody).not.toHaveProperty('view');
  });

  it('PUT view does not write MatchMoveLog; POST move does not change view', async () => {
    const store = createMockStore({
      cursor: { currentSeat: SEAT_ID_1, seatOrder: [SEAT_ID_1, SEAT_ID_2] },
    });
    const send = installMockSend(store);

    await handler(
      eventWithAuth(
        'PUT',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        SEAT_ID_1,
        JSON.stringify({ view: VIEW_PAYLOAD_A }),
      ),
      {} as never,
      () => {},
    );

    const moveLogPutsAfterView = send.mock.calls.filter(
      ([cmd]) =>
        cmd instanceof PutCommand &&
        cmd.input.TableName === MOVE_LOG_TABLE_NAME,
    );
    expect(moveLogPutsAfterView).toHaveLength(0);

    await movesHandler(
      {
        routeKey: 'POST /v1/matches/{matchId}/moves',
        headers: { authorization: `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}` },
        pathParameters: { matchId: MATCH_ID },
        body: JSON.stringify({ seatId: SEAT_ID_1, payload: { move: 1 } }),
        requestContext: { http: { method: 'POST' } },
      } as APIGatewayProxyEventV2,
      {} as never,
      () => {},
    );

    const getAfterMove = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID, SEAT_ID_1),
      {} as never,
      () => {},
    );

    expect(responseBody(getAfterMove!)).toEqual({ seatId: SEAT_ID_1, view: VIEW_PAYLOAD_A });
  });

  it('GET view stays null after POST move without prior PUT view', async () => {
    const store = createMockStore({
      cursor: { currentSeat: SEAT_ID_1, seatOrder: [SEAT_ID_1, SEAT_ID_2] },
    });
    installMockSend(store);

    await movesHandler(
      {
        routeKey: 'POST /v1/matches/{matchId}/moves',
        headers: { authorization: `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}` },
        pathParameters: { matchId: MATCH_ID },
        body: JSON.stringify({ seatId: SEAT_ID_1, payload: { move: 1 } }),
        requestContext: { http: { method: 'POST' } },
      } as APIGatewayProxyEventV2,
      {} as never,
      () => {},
    );

    const getResult = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID, SEAT_ID_1),
      {} as never,
      () => {},
    );

    expect(responseBody(getResult!)).toEqual({ seatId: SEAT_ID_1, view: null });
  });

  it('returns 401 game_auth_required when Authorization is absent', async () => {
    const send = installMockSend(createMockStore());

    const result = await handler(eventWithAuth('GET', undefined), {} as never, () => {});

    expect(statusCode(result!)).toBe(401);
    expect(responseBody(result!)).toMatchObject({ code: 'game_auth_required' });
    expect(send).not.toHaveBeenCalled();
  });

  it('returns 401 game_auth_invalid for an unknown SDK key', async () => {
    const send = vi.fn().mockResolvedValueOnce({ Item: undefined });
    vi.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({
      send,
    } as unknown as DynamoDBDocumentClient);

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
    const send = vi.fn();
    send
      .mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({ Item: undefined });
    vi.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({
      send,
    } as unknown as DynamoDBDocumentClient);

    const result = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(404);
    expect(responseBody(result!)).toMatchObject({ code: 'match_not_found' });
    expect(send.mock.calls.some(([cmd]) => String(cmd.input?.Key?.sk ?? '').startsWith('VIEW#'))).toBe(
      false,
    );
  });

  it('returns 403 match_forbidden when match belongs to another game', async () => {
    const send = vi.fn();
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
    vi.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({
      send,
    } as unknown as DynamoDBDocumentClient);

    const result = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(403);
    const body = responseBody(result!);
    expect(body).toMatchObject({ code: 'match_forbidden' });
    expect(body).not.toHaveProperty('view');
    expect(body).not.toHaveProperty('matchId');
  });

  it('views on match A do not appear on match B', async () => {
    const storeA = createMockStore();
    installMockSend(storeA, MATCH_ID);

    await handler(
      eventWithAuth(
        'PUT',
        `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`,
        MATCH_ID,
        SEAT_ID_1,
        JSON.stringify({ view: VIEW_PAYLOAD_A }),
      ),
      {} as never,
      () => {},
    );

    const storeB = createMockStore({ seats: new Set([SEAT_ID_2]) });
    installMockSend(storeB, MATCH_ID_B);

    const getB = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID_B, SEAT_ID_2),
      {} as never,
      () => {},
    );

    expect(responseBody(getB!)).toEqual({ seatId: SEAT_ID_2, view: null });

    const getBWithASeat = await handler(
      eventWithAuth('GET', `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID_B, SEAT_ID_1),
      {} as never,
      () => {},
    );

    expect(statusCode(getBWithASeat!)).toBe(404);
    expect(responseBody(getBWithASeat!)).toMatchObject({ code: 'seat_not_found' });
  });
});
