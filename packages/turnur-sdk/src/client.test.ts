import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTurnurClient } from './client.js';
import { TurnurApiError } from './errors.js';

const API_KEY = 'turnur_sk_0123456789abcdef0123456789abcdef';
const BASE_URL = 'https://api.turnur.example';
const MATCH_ID = '550e8400-e29b-41d4-a716-446655440000';
const SEAT_ID = 'seat-abc-123';
const SEAT_ID_2 = 'seat-def-456';
const HIDDEN_VIEW = { cards: ['ace', 'king'], playerName: 'secret' };

function mockFetch(response: Response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

function mockFetchFn(fn: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fn);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createTurnurClient', () => {
  it('sends Authorization Bearer header on authenticated requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ gameId: 'game-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    await client.game.me();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/game/me`);
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    });
  });

  it('normalizes trailing slash on baseUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ gameId: 'game-123' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createTurnurClient({ baseUrl: `${BASE_URL}/`, apiKey: API_KEY });
    await client.game.me();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/v1/game/me`);
  });

  it('returns gameId on 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ gameId: 'game-abc' }), { status: 200 }),
      ),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    await expect(client.game.me()).resolves.toEqual({ gameId: 'game-abc' });
  });

  it('throws TurnurApiError with code and message on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'game_auth_invalid',
            message: 'Invalid game SDK key',
            hint: 'Check the Authorization Bearer token format.',
          }),
          { status: 401 },
        ),
      ),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await expect(client.game.me()).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(TurnurApiError);
      const apiError = error as TurnurApiError;
      expect(apiError.status).toBe(401);
      expect(apiError.code).toBe('game_auth_invalid');
      expect(apiError.message).toBe('Invalid game SDK key');
      expect(apiError.hint).toBe('Check the Authorization Bearer token format.');
      expect(String(apiError)).not.toContain(API_KEY);
      return true;
    });
  });
});

describe('createTurnurClient.match', () => {
  it('sends Authorization Bearer header on match.create', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ matchId: 'match-123' }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    await client.match.create();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/matches`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    });
  });

  it('returns matchId on 201 response from match.create', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ matchId: '550e8400-e29b-41d4-a716-446655440000' }), {
          status: 201,
        }),
      ),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    await expect(client.match.create()).resolves.toEqual({
      matchId: '550e8400-e29b-41d4-a716-446655440000',
    });
  });

  it('sends Authorization Bearer header on match.get', async () => {
    const matchId = '550e8400-e29b-41d4-a716-446655440000';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          matchId,
          status: 'created',
          createdAt: '2026-08-27T12:00:00.000Z',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    await client.match.get(matchId);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/matches/${encodeURIComponent(matchId)}`);
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    });
  });

  it('URL-encodes matchId in match.get path', async () => {
    const matchId = 'match/with/slashes';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          matchId,
          status: 'created',
          createdAt: '2026-08-27T12:00:00.000Z',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    await client.match.get(matchId);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/v1/matches/${encodeURIComponent(matchId)}`);
  });

  it('returns match fields on 200 response from match.get', async () => {
    const matchId = '550e8400-e29b-41d4-a716-446655440000';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            matchId,
            status: 'created',
            createdAt: '2026-08-27T12:00:00.000Z',
          }),
          { status: 200 },
        ),
      ),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    await expect(client.match.get(matchId)).resolves.toEqual({
      matchId,
      status: 'created',
      createdAt: '2026-08-27T12:00:00.000Z',
    });
  });

  it('throws TurnurApiError with code and message on 401 from match.create', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'game_auth_invalid',
            message: 'Invalid game SDK key',
          }),
          { status: 401 },
        ),
      ),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await expect(client.match.create()).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(TurnurApiError);
      const apiError = error as TurnurApiError;
      expect(apiError.status).toBe(401);
      expect(apiError.code).toBe('game_auth_invalid');
      expect(apiError.message).toBe('Invalid game SDK key');
      expect(String(apiError)).not.toContain(API_KEY);
      return true;
    });
  });

  it('throws TurnurApiError with code and message on 403 from match.get', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'match_forbidden',
            message: 'Match belongs to another game',
            hint: 'Use the SDK key for the game that created this match.',
          }),
          { status: 403 },
        ),
      ),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await expect(client.match.get('some-match-id')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(TurnurApiError);
      const apiError = error as TurnurApiError;
      expect(apiError.status).toBe(403);
      expect(apiError.code).toBe('match_forbidden');
      expect(apiError.message).toBe('Match belongs to another game');
      expect(apiError.hint).toBe('Use the SDK key for the game that created this match.');
      expect(String(apiError)).not.toContain(API_KEY);
      return true;
    });
  });

  it('throws TurnurApiError with code and message on 404 from match.get', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'match_not_found',
            message: 'Match not found',
            hint: 'Verify the matchId exists and was created via POST /v1/matches for your game.',
          }),
          { status: 404 },
        ),
      ),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await expect(client.match.get('missing-match-id')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(TurnurApiError);
      const apiError = error as TurnurApiError;
      expect(apiError.status).toBe(404);
      expect(apiError.code).toBe('match_not_found');
      expect(apiError.message).toBe('Match not found');
      expect(String(apiError)).not.toContain(API_KEY);
      return true;
    });
  });
});

describe('createTurnurClient.match.seat', () => {
  it('seat.create sends POST with no body and returns seatId and currentSeat', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ seatId: SEAT_ID, currentSeat: null }),
        { status: 201 },
      ),
    );
    mockFetchFn(fetchMock);

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    const result = await client.match.seat.create(MATCH_ID);

    expect(result).toEqual({ seatId: SEAT_ID, currentSeat: null });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/matches/${encodeURIComponent(MATCH_ID)}/seats`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    });
  });

  it('seat.list returns roster and currentSeat without hidden views', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          seats: [
            { seatId: SEAT_ID, createdAt: '2026-08-27T12:00:00.000Z', view: HIDDEN_VIEW },
            { seatId: SEAT_ID_2, createdAt: '2026-08-27T12:01:00.000Z', hiddenView: HIDDEN_VIEW },
          ],
          currentSeat: SEAT_ID,
          views: [HIDDEN_VIEW],
        }),
        { status: 200 },
      ),
    );
    mockFetchFn(fetchMock);

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    const result = await client.match.seat.list(MATCH_ID);

    expect(result).toEqual({
      seats: [
        { seatId: SEAT_ID, createdAt: '2026-08-27T12:00:00.000Z' },
        { seatId: SEAT_ID_2, createdAt: '2026-08-27T12:01:00.000Z' },
      ],
      currentSeat: SEAT_ID,
    });
    expect(JSON.stringify(result)).not.toContain('cards');
  });

  it('seat.list returns empty roster when no seats exist', async () => {
    mockFetch(
      new Response(JSON.stringify({ seats: [], currentSeat: null }), { status: 200 }),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    await expect(client.match.seat.list(MATCH_ID)).resolves.toEqual({
      seats: [],
      currentSeat: null,
    });
  });

  it('URL-encodes matchId in seat paths', async () => {
    const matchId = 'match/with/slashes';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ seatId: SEAT_ID, currentSeat: null }), { status: 201 }),
    );
    mockFetchFn(fetchMock);

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    await client.match.seat.create(matchId);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/v1/matches/${encodeURIComponent(matchId)}/seats`);
  });
});

describe('createTurnurClient.match.turn', () => {
  it('turn.get returns currentSeat', async () => {
    mockFetch(
      new Response(JSON.stringify({ currentSeat: SEAT_ID, view: HIDDEN_VIEW }), { status: 200 }),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    await expect(client.match.turn.get(MATCH_ID)).resolves.toEqual({ currentSeat: SEAT_ID });
  });

  it('turn.get returns null currentSeat when none designated', async () => {
    mockFetch(new Response(JSON.stringify({ currentSeat: null }), { status: 200 }));

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    await expect(client.match.turn.get(MATCH_ID)).resolves.toEqual({ currentSeat: null });
  });

  it('turn.set sends PUT with seatId body and returns currentSeat', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ currentSeat: SEAT_ID }), { status: 200 }),
    );
    mockFetchFn(fetchMock);

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    const result = await client.match.turn.set(MATCH_ID, SEAT_ID);

    expect(result).toEqual({ currentSeat: SEAT_ID });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/matches/${encodeURIComponent(MATCH_ID)}/turn`);
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ seatId: SEAT_ID }));
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
  });
});

describe('createTurnurClient.match.move', () => {
  it('move.create sends POST with seatId and payload and returns without payload', async () => {
    const payload = { action: 'play', card: 'ace' };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          seq: 1,
          seatId: SEAT_ID,
          createdAt: '2026-08-27T12:00:00.000Z',
          currentSeat: SEAT_ID,
          payload,
          view: HIDDEN_VIEW,
        }),
        { status: 201 },
      ),
    );
    mockFetchFn(fetchMock);

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    const result = await client.match.move.create(MATCH_ID, { seatId: SEAT_ID, payload });

    expect(result).toEqual({
      seq: 1,
      seatId: SEAT_ID,
      createdAt: '2026-08-27T12:00:00.000Z',
      currentSeat: SEAT_ID,
    });
    expect(result).not.toHaveProperty('payload');
    expect(result).not.toHaveProperty('view');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/matches/${encodeURIComponent(MATCH_ID)}/moves`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ seatId: SEAT_ID, payload }));
  });

  it('move.create throws TurnurApiError on 409 illegal_turn', async () => {
    mockFetch(
      new Response(
        JSON.stringify({ code: 'illegal_turn', message: 'Not this seat\'s turn' }),
        { status: 409 },
      ),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await expect(
      client.match.move.create(MATCH_ID, { seatId: SEAT_ID, payload: {} }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(TurnurApiError);
      const apiError = error as TurnurApiError;
      expect(apiError.status).toBe(409);
      expect(apiError.code).toBe('illegal_turn');
      expect(apiError.message).toBe('Not this seat\'s turn');
      expect(String(apiError)).not.toContain(API_KEY);
      return true;
    });
  });
});

describe('createTurnurClient.match.view', () => {
  it('view.put sends PUT with view body and returns seatId only', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ seatId: SEAT_ID, view: HIDDEN_VIEW }), { status: 200 }),
    );
    mockFetchFn(fetchMock);

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    const result = await client.match.view.put(MATCH_ID, SEAT_ID, HIDDEN_VIEW);

    expect(result).toEqual({ seatId: SEAT_ID });
    expect(result).not.toHaveProperty('view');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/v1/matches/${encodeURIComponent(MATCH_ID)}/seats/${encodeURIComponent(SEAT_ID)}/view`,
    );
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ view: HIDDEN_VIEW }));
  });

  it('view.get returns seatId and view for requested seat only', async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          seatId: SEAT_ID,
          view: HIDDEN_VIEW,
          views: [{ seatId: SEAT_ID_2, view: { other: true } }],
        }),
        { status: 200 },
      ),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    const result = await client.match.view.get(MATCH_ID, SEAT_ID);

    expect(Object.keys(result).sort()).toEqual(['seatId', 'view']);
    expect(result).toEqual({ seatId: SEAT_ID, view: HIDDEN_VIEW });
  });

  it('view.get returns null view when unset', async () => {
    mockFetch(
      new Response(JSON.stringify({ seatId: SEAT_ID, view: null }), { status: 200 }),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    await expect(client.match.view.get(MATCH_ID, SEAT_ID)).resolves.toEqual({
      seatId: SEAT_ID,
      view: null,
    });
  });

  it('URL-encodes seatId in view paths', async () => {
    const seatId = 'seat/with/slashes';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ seatId, view: null }), { status: 200 }),
    );
    mockFetchFn(fetchMock);

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    await client.match.view.get(MATCH_ID, seatId);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      `${BASE_URL}/v1/matches/${encodeURIComponent(MATCH_ID)}/seats/${encodeURIComponent(seatId)}/view`,
    );
  });

  it('view.put error does not contain hidden view fixture', async () => {
    mockFetch(
      new Response(
        JSON.stringify({ code: 'seat_not_found', message: 'Seat not found' }),
        { status: 404 },
      ),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await expect(
      client.match.view.put(MATCH_ID, SEAT_ID, HIDDEN_VIEW),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(TurnurApiError);
      expect(String(error)).not.toContain('ace');
      expect(String(error)).not.toContain(API_KEY);
      return true;
    });
  });
});

describe('createTurnurClient.match.moves', () => {
  it('moves.list returns items with payload in accept order', async () => {
    const payloadA = { action: 'play', card: 'ace' };
    const payloadB = { action: 'pass' };
    mockFetch(
      new Response(
        JSON.stringify({
          items: [
            {
              seq: 1,
              seatId: SEAT_ID,
              payload: payloadA,
              createdAt: '2026-08-27T12:00:00.000Z',
            },
            {
              seq: 2,
              seatId: SEAT_ID_2,
              payload: payloadB,
              createdAt: '2026-08-27T12:01:00.000Z',
            },
          ],
          view: HIDDEN_VIEW,
        }),
        { status: 200 },
      ),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    const result = await client.match.moves.list(MATCH_ID);

    expect(result).toEqual({
      items: [
        { seq: 1, seatId: SEAT_ID, payload: payloadA, createdAt: '2026-08-27T12:00:00.000Z' },
        { seq: 2, seatId: SEAT_ID_2, payload: payloadB, createdAt: '2026-08-27T12:01:00.000Z' },
      ],
    });
    expect(result).not.toHaveProperty('view');
    expect(JSON.stringify(result)).not.toContain('cards');
  });

  it('moves.list returns empty items when no moves exist', async () => {
    mockFetch(new Response(JSON.stringify({ items: [] }), { status: 200 }));

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    await expect(client.match.moves.list(MATCH_ID)).resolves.toEqual({ items: [] });
  });
});

describe('createTurnurClient.match authority errors', () => {
  it('throws TurnurApiError on 400 invalid_request', async () => {
    mockFetch(
      new Response(
        JSON.stringify({ code: 'invalid_request', message: 'Missing seatId' }),
        { status: 400 },
      ),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await expect(client.match.turn.set(MATCH_ID, '')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(TurnurApiError);
      const apiError = error as TurnurApiError;
      expect(apiError.status).toBe(400);
      expect(apiError.code).toBe('invalid_request');
      expect(apiError.message).toBe('Missing seatId');
      expect(String(apiError)).not.toContain(API_KEY);
      return true;
    });
  });

  it('throws TurnurApiError on 401 game_auth_required', async () => {
    mockFetch(
      new Response(
        JSON.stringify({ code: 'game_auth_required', message: 'Authorization required' }),
        { status: 401 },
      ),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await expect(client.match.seat.list(MATCH_ID)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(TurnurApiError);
      const apiError = error as TurnurApiError;
      expect(apiError.status).toBe(401);
      expect(apiError.code).toBe('game_auth_required');
      expect(String(apiError)).not.toContain(API_KEY);
      return true;
    });
  });

  it('throws TurnurApiError on 403 match_forbidden', async () => {
    mockFetch(
      new Response(
        JSON.stringify({ code: 'match_forbidden', message: 'Match belongs to another game' }),
        { status: 403 },
      ),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await expect(client.match.moves.list(MATCH_ID)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(TurnurApiError);
      const apiError = error as TurnurApiError;
      expect(apiError.status).toBe(403);
      expect(apiError.code).toBe('match_forbidden');
      expect(String(apiError)).not.toContain(API_KEY);
      return true;
    });
  });

  it('throws TurnurApiError on 404 seat_not_found', async () => {
    mockFetch(
      new Response(
        JSON.stringify({ code: 'seat_not_found', message: 'Seat not found' }),
        { status: 404 },
      ),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await expect(client.match.turn.set(MATCH_ID, 'unknown-seat')).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(TurnurApiError);
        const apiError = error as TurnurApiError;
        expect(apiError.status).toBe(404);
        expect(apiError.code).toBe('seat_not_found');
        expect(String(apiError)).not.toContain(API_KEY);
        return true;
      },
    );
  });

  it('throws TurnurApiError on 404 match_not_found', async () => {
    mockFetch(
      new Response(
        JSON.stringify({ code: 'match_not_found', message: 'Match not found' }),
        { status: 404 },
      ),
    );

    const client = createTurnurClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await expect(client.match.seat.create('missing-match')).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(TurnurApiError);
        const apiError = error as TurnurApiError;
        expect(apiError.status).toBe(404);
        expect(apiError.code).toBe('match_not_found');
        expect(String(apiError)).not.toContain(API_KEY);
        return true;
      },
    );
  });
});
