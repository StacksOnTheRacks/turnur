import { authenticatedGet, throwUnauthorized } from './http.js';
import { TurnurApiError } from './errors.js';
import type { GameMeResponse, TurnurClientConfig } from './types.js';

export type TurnurClient = {
  game: {
    me(): Promise<GameMeResponse>;
  };
};

export function createTurnurClient(config: TurnurClientConfig): TurnurClient {
  const { baseUrl, apiKey } = config;

  return {
    game: {
      async me(): Promise<GameMeResponse> {
        const { status, body } = await authenticatedGet(baseUrl, apiKey, '/v1/game/me');

        if (status === 401) {
          throwUnauthorized(body);
        }

        if (status !== 200) {
          throw new TurnurApiError(status, `Request failed with status ${status}`);
        }

        if (!body || typeof (body as GameMeResponse).gameId !== 'string') {
          throw new TurnurApiError(status, 'Invalid response: missing gameId');
        }

        return { gameId: (body as GameMeResponse).gameId };
      },
    },
  };
}
