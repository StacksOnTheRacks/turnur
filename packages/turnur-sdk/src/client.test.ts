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
