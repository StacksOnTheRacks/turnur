import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTurnurClient } from './client.js';
import { TurnurApiError } from './errors.js';

const API_KEY = 'turnur_sk_0123456789abcdef0123456789abcdef';
const BASE_URL = 'https://api.turnur.example';

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
