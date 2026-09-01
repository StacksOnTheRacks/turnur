import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEV_FIXTURE_GAME_ID } from '../lib/game-auth/constants';
import { DEV_FIXTURE_PLAINTEXT_SDK_KEY } from '../test-fixtures/dev-game-key';
import { handler as movesHandler } from './matches-moves-handler';
import { handler as turnHandler } from './matches-turn-handler';
import { handler as viewHandler } from './matches-view-handler';
import { handler } from './matches-move-log-handler';

const GAME_TABLE_NAME = 'GameRegistryTest';
const MATCH_TABLE_NAME = 'MatchRegistryTest';
const STATE_TABLE_NAME = 'MatchStateTest';
const MOVE_LOG_TABLE_NAME = 'MatchMoveLogTest';
const MATCH_ID = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
const MATCH_ID_B = 'bbbbbbbb-bbbb-4ccc-dddd-eeeeeeeeeeee';
const OTHER_GAME_ID = 'game_other_00000000000000000000000000000000';
const SEAT_ID_1 = '11111111-1111-4111-8111-111111111111';
const SEAT_ID_2 = '22222222-2222-4222-8222-222222222222';
const PAYLOAD_A = { action: 'first', value: 1 };
const PAYLOAD_B = { action: 'second', value: 2 };
const VIEW_PAYLOAD = { cards: ['ace', 'king'], secret: true };
const CREATED_AT_1 = '2026-08-27T12:00:01.000Z';
const CREATED_AT_2 = '2026-08-27T12:00:02.000Z';

type MoveLogStore = Map<string, Array<{ seq: number; seatId: string; payload: unknown; createdAt: string }>>;

function eventWithAuth(
  value: string | undefined,
  matchId: string = MATCH_ID,
): APIGatewayProxyEventV2 {
  const headers = value === undefined ? {} : { authorization: value };
  return {
    routeKey: 'GET /v1/matches/{matchId}/moves',
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

function createMoveLogStore(initial?: MoveLogStore): MoveLogStore {
  return initial ?? new Map();
}

function installMockSend(
  moveLogStore: MoveLogStore,
  matchId: string = MATCH_ID,
  gameId: string = DEV_FIXTURE_GAME_ID,
): ReturnType<typeof vi.fn> {
  const send = vi.fn(async (cmd) => {
    if (cmd instanceof GetCommand) {
      const key = cmd.input.Key;
      if (key?.keyHash !== undefined) {
        return { Item: { gameId: DEV_FIXTURE_GAME_ID } };
      }
      if (key?.matchId !== undefined && key?.sk === undefined) {
        if (key.matchId === matchId || key.matchId === MATCH_ID || key.matchId === MATCH_ID_B) {
          return { Item: { matchId: key.matchId, gameId } };
        }
        return { Item: undefined };
      }
    }
    if (cmd instanceof QueryCommand) {
      const queryMatchId = cmd.input.ExpressionAttributeValues?.[':matchId'] as string;
      const moves = moveLogStore.get(queryMatchId) ?? [];
      const scanForward = cmd.input.ScanIndexForward ?? true;
      const sorted = [...moves].sort((a, b) => (scanForward ? a.seq - b.seq : b.seq - a.seq));
      return {
        Items: sorted.map((move) => ({
          matchId: queryMatchId,
          seq: move.seq,
          seatId: move.seatId,
          payload: move.payload,
          createdAt: move.createdAt,
        })),
      };
    }
    return {};
  });

  vi.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({
    send,
  } as unknown as DynamoDBDocumentClient);

  return send;
}

describe('matches-move-log-handler', () => {
  beforeEach(() => {
    process.env.GAME_REGISTRY_TABLE_NAME = GAME_TABLE_NAME;
    process.env.MATCH_REGISTRY_TABLE_NAME = MATCH_TABLE_NAME;
    process.env.MATCH_MOVE_LOG_TABLE_NAME = MOVE_LOG_TABLE_NAME;
    process.env.MATCH_STATE_TABLE_NAME = STATE_TABLE_NAME;
    vi.restoreAllMocks();
  });

  it('returns 200 with empty items for owned match with no moves', async () => {
    const send = installMockSend(createMoveLogStore());

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(200);
    expect(result).toMatchObject({
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    expect(responseBody(result!)).toEqual({ items: [] });
    expect(Object.keys(responseBody(result!))).toEqual(['items']);

    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenNthCalledWith(1, expect.any(GetCommand));
    expect(send).toHaveBeenNthCalledWith(2, expect.any(GetCommand));
    expect(send).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: MOVE_LOG_TABLE_NAME,
          KeyConditionExpression: 'matchId = :matchId',
          ExpressionAttributeValues: { ':matchId': MATCH_ID },
          ScanIndexForward: true,
        }),
      }),
    );
  });

  it('returns two accepted moves in seq ascending order with payloads', async () => {
    const store = createMoveLogStore(
      new Map([
        [
          MATCH_ID,
          [
            { seq: 1, seatId: SEAT_ID_1, payload: PAYLOAD_A, createdAt: CREATED_AT_1 },
            { seq: 2, seatId: SEAT_ID_2, payload: PAYLOAD_B, createdAt: CREATED_AT_2 },
          ],
        ],
      ]),
    );
    installMockSend(store);

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(200);
    const body = responseBody(result!);
    expect(Object.keys(body)).toEqual(['items']);
    expect(body.items).toHaveLength(2);

    const items = body.items as Array<Record<string, unknown>>;
    expect(Object.keys(items[0])).toEqual(['seq', 'seatId', 'payload', 'createdAt']);
    expect(items[0]).toEqual({
      seq: 1,
      seatId: SEAT_ID_1,
      payload: PAYLOAD_A,
      createdAt: CREATED_AT_1,
    });
    expect(items[1]).toEqual({
      seq: 2,
      seatId: SEAT_ID_2,
      payload: PAYLOAD_B,
      createdAt: CREATED_AT_2,
    });
    expect(typeof items[0].seq).toBe('number');
    expect(typeof items[1].seq).toBe('number');

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('currentSeat');
    expect(serialized).not.toContain('view');
    expect(serialized).not.toContain('views');
    expect(serialized).not.toContain('hiddenView');
    expect(serialized).not.toContain('cursor');
    expect(serialized).not.toContain('nextToken');
    expect(serialized).not.toContain('limit');
  });

  it('returns two on-turn accepts for the same seat in seq order', async () => {
    const store = createMoveLogStore(
      new Map([
        [
          MATCH_ID,
          [
            { seq: 1, seatId: SEAT_ID_1, payload: { turn: 1 }, createdAt: CREATED_AT_1 },
            { seq: 2, seatId: SEAT_ID_1, payload: { turn: 2 }, createdAt: CREATED_AT_2 },
          ],
        ],
      ]),
    );
    installMockSend(store);

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    const items = responseBody(result!).items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0].seq).toBe(1);
    expect(items[1].seq).toBe(2);
    expect(items[0].payload).toEqual({ turn: 1 });
    expect(items[1].payload).toEqual({ turn: 2 });
  });

  it('returns payload {} unchanged on GET item', async () => {
    const store = createMoveLogStore(
      new Map([[MATCH_ID, [{ seq: 1, seatId: SEAT_ID_1, payload: {}, createdAt: CREATED_AT_1 }]]]),
    );
    installMockSend(store);

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    const items = responseBody(result!).items as Array<Record<string, unknown>>;
    expect(items[0].payload).toEqual({});
  });

  it('strips extra stored attributes from response items', async () => {
    const send = vi.fn();
    send
      .mockResolvedValueOnce({ Item: { gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({ Item: { matchId: MATCH_ID, gameId: DEV_FIXTURE_GAME_ID } })
      .mockResolvedValueOnce({
        Items: [
          {
            matchId: MATCH_ID,
            seq: 1,
            seatId: SEAT_ID_1,
            payload: PAYLOAD_A,
            createdAt: CREATED_AT_1,
            name: 'player-one',
            email: 'a@example.com',
            playerId: 'p1',
          },
        ],
      });
    vi.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({
      send,
    } as unknown as DynamoDBDocumentClient);

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    const items = responseBody(result!).items as Array<Record<string, unknown>>;
    expect(Object.keys(items[0])).toEqual(['seq', 'seatId', 'payload', 'createdAt']);
    expect(items[0]).not.toHaveProperty('name');
    expect(items[0]).not.toHaveProperty('email');
    expect(items[0]).not.toHaveProperty('playerId');
  });

  it('does not include rejected off-turn moves in items', async () => {
    const store = createMoveLogStore(
      new Map([
        [
          MATCH_ID,
          [{ seq: 1, seatId: SEAT_ID_1, payload: { valid: true }, createdAt: CREATED_AT_1 }],
        ],
      ]),
    );
    installMockSend(store);

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    const items = responseBody(result!).items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0].payload).toEqual({ valid: true });
    expect(items.some((item) => (item.payload as { action?: string })?.action === 'off-turn')).toBe(
      false,
    );
  });

  it('returns 200 empty items when only off-turn attempts exist (no accepted moves)', async () => {
    installMockSend(createMoveLogStore());

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(200);
    expect(responseBody(result!)).toEqual({ items: [] });
  });

  it('omits hidden views after PUT view on a seated seat', async () => {
    const store = createMoveLogStore(
      new Map([
        [
          MATCH_ID,
          [{ seq: 1, seatId: SEAT_ID_1, payload: PAYLOAD_A, createdAt: CREATED_AT_1 }],
        ],
      ]),
    );
    installMockSend(store);

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    const body = responseBody(result!);
    expect(body).not.toHaveProperty('view');
    expect(body).not.toHaveProperty('views');
    expect(body).not.toHaveProperty('hiddenView');
    const items = body.items as Array<Record<string, unknown>>;
    expect(Object.keys(items[0])).toEqual(['seq', 'seatId', 'payload', 'createdAt']);
    expect(items[0].payload).toEqual(PAYLOAD_A);
    expect(JSON.stringify(body)).not.toContain(JSON.stringify(VIEW_PAYLOAD));
  });

  it('queries MatchMoveLog only after ownership with ScanIndexForward true', async () => {
    const send = installMockSend(createMoveLogStore());

    await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    const queryCalls = send.mock.calls.filter(([cmd]) => cmd instanceof QueryCommand);
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0][0].input.ScanIndexForward).toBe(true);
    expect(queryCalls[0][0].input.Limit).toBeUndefined();
    expect(queryCalls[0][0].input.ExclusiveStartKey).toBeUndefined();

    const getCalls = send.mock.calls.filter(([cmd]) => cmd instanceof GetCommand);
    expect(getCalls).toHaveLength(2);
    expect(getCalls[1][0].input.Key).toEqual({ matchId: MATCH_ID });
  });

  it('returns 401 game_auth_required when Authorization is absent', async () => {
    const send = installMockSend(createMoveLogStore());

    const result = await handler(eventWithAuth(undefined), {} as never, () => {});

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
      eventWithAuth('Bearer turnur_sk_11111111111111111111111111111111'),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(401);
    expect(responseBody(result!)).toMatchObject({ code: 'game_auth_invalid' });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls.some(([cmd]) => cmd instanceof QueryCommand)).toBe(false);
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
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(404);
    expect(responseBody(result!)).toMatchObject({ code: 'match_not_found' });
    expect(send.mock.calls.some(([cmd]) => cmd instanceof QueryCommand)).toBe(false);
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
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(403);
    const body = responseBody(result!);
    expect(body).toMatchObject({ code: 'match_forbidden' });
    expect(body).not.toHaveProperty('items');
    expect(body).not.toHaveProperty('matchId');
    expect(body).not.toHaveProperty('payload');
    expect(body).not.toHaveProperty('view');
    expect(send.mock.calls.some(([cmd]) => cmd instanceof QueryCommand)).toBe(false);
  });

  it('does not include match A moves when querying match B', async () => {
    const store = createMoveLogStore(
      new Map([
        [
          MATCH_ID,
          [{ seq: 1, seatId: SEAT_ID_1, payload: PAYLOAD_A, createdAt: CREATED_AT_1 }],
        ],
      ]),
    );
    installMockSend(store, MATCH_ID_B);

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID_B),
      {} as never,
      () => {},
    );

    expect(statusCode(result!)).toBe(200);
    expect(responseBody(result!)).toEqual({ items: [] });
  });

  it('returns only match B moves after accept on B', async () => {
    const store = createMoveLogStore(
      new Map([
        [
          MATCH_ID,
          [{ seq: 1, seatId: SEAT_ID_1, payload: PAYLOAD_A, createdAt: CREATED_AT_1 }],
        ],
        [
          MATCH_ID_B,
          [{ seq: 1, seatId: SEAT_ID_2, payload: { onB: true }, createdAt: CREATED_AT_1 }],
        ],
      ]),
    );
    installMockSend(store, MATCH_ID_B);

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`, MATCH_ID_B),
      {} as never,
      () => {},
    );

    const items = responseBody(result!).items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0].seq).toBe(1);
    expect(items[0].payload).toEqual({ onB: true });
    expect(items[0]).not.toHaveProperty('seatId', SEAT_ID_1);
  });
});

describe('matches-move-log-handler integration with turn/moves/view', () => {
  type StateStore = {
    seats: Set<string>;
    views: Map<string, unknown>;
    cursor: { currentSeat: string | null; seatOrder: string[] };
    moves: Array<{ seq: number; seatId: string; payload: unknown; createdAt: string }>;
  };

  function createStateStore(initial?: Partial<StateStore>): StateStore {
    return {
      seats: new Set(initial?.seats ?? [SEAT_ID_1, SEAT_ID_2]),
      views: new Map(initial?.views ?? []),
      cursor: initial?.cursor ?? { currentSeat: null, seatOrder: [SEAT_ID_1, SEAT_ID_2] },
      moves: initial?.moves ?? [],
    };
  }

  function installIntegrationMock(store: StateStore, matchId: string = MATCH_ID): ReturnType<typeof vi.fn> {
    const send = vi.fn(async (cmd) => {
      if (cmd instanceof GetCommand) {
        const key = cmd.input.Key;
        if (key?.keyHash !== undefined) {
          return { Item: { gameId: DEV_FIXTURE_GAME_ID } };
        }
        if (key?.matchId !== undefined && key?.sk === undefined) {
          return { Item: { matchId: key.matchId, gameId: DEV_FIXTURE_GAME_ID } };
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
                createdAt: CREATED_AT_1,
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
          return { Item: { matchId: key.matchId, sk: key.sk, view } };
        }
      }
      if (cmd instanceof QueryCommand) {
        const queryMatchId = cmd.input.ExpressionAttributeValues?.[':matchId'] as string;
        const scanForward = cmd.input.ScanIndexForward ?? true;
        const limit = cmd.input.Limit;
        let items = store.moves
          .filter((move) => move.seq !== undefined)
          .sort((a, b) => (scanForward ? a.seq - b.seq : b.seq - a.seq));
        if (limit !== undefined) {
          items = items.slice(0, limit);
        }
        return {
          Items: items.map((move) => ({
            matchId: queryMatchId,
            seq: move.seq,
            seatId: move.seatId,
            payload: move.payload,
            createdAt: move.createdAt,
          })),
        };
      }
      if (cmd instanceof PutCommand) {
        const item = cmd.input.Item as {
          matchId?: string;
          sk?: string;
          seq?: number;
          seatId?: string;
          payload?: unknown;
          createdAt?: string;
          view?: unknown;
        };
        if (item.sk === 'CURSOR' && item.currentSeat !== undefined) {
          store.cursor.currentSeat = item.currentSeat as string | null;
        }
        if (typeof item.sk === 'string' && item.sk.startsWith('VIEW#')) {
          const seatId = item.sk.slice('VIEW#'.length);
          store.views.set(seatId, item.view);
        }
        if (item.seq !== undefined && item.seatId !== undefined) {
          store.moves.push({
            seq: item.seq,
            seatId: item.seatId,
            payload: item.payload,
            createdAt: item.createdAt ?? CREATED_AT_1,
          });
        }
        return {};
      }
      return {};
    });

    vi.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({
      send,
    } as unknown as DynamoDBDocumentClient);

    return send;
  }

  beforeEach(() => {
    process.env.GAME_REGISTRY_TABLE_NAME = GAME_TABLE_NAME;
    process.env.MATCH_REGISTRY_TABLE_NAME = MATCH_TABLE_NAME;
    process.env.MATCH_STATE_TABLE_NAME = STATE_TABLE_NAME;
    process.env.MATCH_MOVE_LOG_TABLE_NAME = MOVE_LOG_TABLE_NAME;
    vi.restoreAllMocks();
  });

  it('returns two items after designate-first, move-first, designate-second, move-second flow', async () => {
    const store = createStateStore();
    installIntegrationMock(store);

    await turnHandler(
      {
        routeKey: 'PUT /v1/matches/{matchId}/turn',
        headers: { authorization: `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}` },
        pathParameters: { matchId: MATCH_ID },
        body: JSON.stringify({ seatId: SEAT_ID_1 }),
        requestContext: { http: { method: 'PUT' } },
      } as APIGatewayProxyEventV2,
      {} as never,
      () => {},
    );

    await movesHandler(
      {
        routeKey: 'POST /v1/matches/{matchId}/moves',
        headers: { authorization: `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}` },
        pathParameters: { matchId: MATCH_ID },
        body: JSON.stringify({ seatId: SEAT_ID_1, payload: PAYLOAD_A }),
        requestContext: { http: { method: 'POST' } },
      } as APIGatewayProxyEventV2,
      {} as never,
      () => {},
    );

    await turnHandler(
      {
        routeKey: 'PUT /v1/matches/{matchId}/turn',
        headers: { authorization: `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}` },
        pathParameters: { matchId: MATCH_ID },
        body: JSON.stringify({ seatId: SEAT_ID_2 }),
        requestContext: { http: { method: 'PUT' } },
      } as APIGatewayProxyEventV2,
      {} as never,
      () => {},
    );

    await movesHandler(
      {
        routeKey: 'POST /v1/matches/{matchId}/moves',
        headers: { authorization: `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}` },
        pathParameters: { matchId: MATCH_ID },
        body: JSON.stringify({ seatId: SEAT_ID_2, payload: PAYLOAD_B }),
        requestContext: { http: { method: 'POST' } },
      } as APIGatewayProxyEventV2,
      {} as never,
      () => {},
    );

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    const items = responseBody(result!).items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ seq: 1, seatId: SEAT_ID_1, payload: PAYLOAD_A });
    expect(items[1]).toMatchObject({ seq: 2, seatId: SEAT_ID_2, payload: PAYLOAD_B });
  });

  it('excludes off-turn POST from GET after later on-turn accept', async () => {
    const store = createStateStore({
      cursor: { currentSeat: SEAT_ID_1, seatOrder: [SEAT_ID_1, SEAT_ID_2] },
    });
    installIntegrationMock(store);

    await movesHandler(
      {
        routeKey: 'POST /v1/matches/{matchId}/moves',
        headers: { authorization: `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}` },
        pathParameters: { matchId: MATCH_ID },
        body: JSON.stringify({ seatId: SEAT_ID_2, payload: { rejected: true } }),
        requestContext: { http: { method: 'POST' } },
      } as APIGatewayProxyEventV2,
      {} as never,
      () => {},
    );

    await movesHandler(
      {
        routeKey: 'POST /v1/matches/{matchId}/moves',
        headers: { authorization: `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}` },
        pathParameters: { matchId: MATCH_ID },
        body: JSON.stringify({ seatId: SEAT_ID_1, payload: { accepted: true } }),
        requestContext: { http: { method: 'POST' } },
      } as APIGatewayProxyEventV2,
      {} as never,
      () => {},
    );

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    const items = responseBody(result!).items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0].payload).toEqual({ accepted: true });
    expect(items[0].seq).toBe(1);
  });

  it('GET /moves omits views after PUT view and accepted move', async () => {
    const store = createStateStore({
      cursor: { currentSeat: SEAT_ID_1, seatOrder: [SEAT_ID_1, SEAT_ID_2] },
    });
    installIntegrationMock(store);

    await viewHandler(
      {
        routeKey: 'PUT /v1/matches/{matchId}/seats/{seatId}/view',
        headers: { authorization: `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}` },
        pathParameters: { matchId: MATCH_ID, seatId: SEAT_ID_1 },
        body: JSON.stringify({ view: VIEW_PAYLOAD }),
        requestContext: { http: { method: 'PUT' } },
      } as APIGatewayProxyEventV2,
      {} as never,
      () => {},
    );

    await movesHandler(
      {
        routeKey: 'POST /v1/matches/{matchId}/moves',
        headers: { authorization: `Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}` },
        pathParameters: { matchId: MATCH_ID },
        body: JSON.stringify({ seatId: SEAT_ID_1, payload: PAYLOAD_A }),
        requestContext: { http: { method: 'POST' } },
      } as APIGatewayProxyEventV2,
      {} as never,
      () => {},
    );

    const result = await handler(
      eventWithAuth(`Bearer ${DEV_FIXTURE_PLAINTEXT_SDK_KEY}`),
      {} as never,
      () => {},
    );

    const body = responseBody(result!);
    expect(body).not.toHaveProperty('view');
    expect(body).not.toHaveProperty('views');
    expect(body).not.toHaveProperty('hiddenView');
    const items = body.items as Array<Record<string, unknown>>;
    expect(items[0].payload).toEqual(PAYLOAD_A);
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
