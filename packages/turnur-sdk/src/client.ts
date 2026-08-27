import {
  authenticatedGet,
  authenticatedPost,
  throwStructuredError,
  throwUnauthorized,
} from './http.js';
import { TurnurApiError } from './errors.js';
import type {
  GameMeResponse,
  MatchCreateResponse,
  MatchGetResponse,
  TurnurClientConfig,
} from './types.js';

export type TurnurClient = {
  game: {
    me(): Promise<GameMeResponse>;
  };
  match: {
    create(): Promise<MatchCreateResponse>;
    get(matchId: string): Promise<MatchGetResponse>;
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
    match: {
      async create(): Promise<MatchCreateResponse> {
        const { status, body } = await authenticatedPost(baseUrl, apiKey, '/v1/matches');

        if (status === 401) {
          throwUnauthorized(body);
        }

        if (status === 403 || status === 404) {
          throwStructuredError(status, body);
        }

        if (status !== 201) {
          throw new TurnurApiError(status, `Request failed with status ${status}`);
        }

        if (!body || typeof (body as MatchCreateResponse).matchId !== 'string') {
          throw new TurnurApiError(status, 'Invalid response: missing matchId');
        }

        return { matchId: (body as MatchCreateResponse).matchId };
      },

      async get(matchId: string): Promise<MatchGetResponse> {
        const path = `/v1/matches/${encodeURIComponent(matchId)}`;
        const { status, body } = await authenticatedGet(baseUrl, apiKey, path);

        if (status === 401) {
          throwUnauthorized(body);
        }

        if (status === 403 || status === 404) {
          throwStructuredError(status, body);
        }

        if (status !== 200) {
          throw new TurnurApiError(status, `Request failed with status ${status}`);
        }

        const response = body as MatchGetResponse;
        if (
          !body ||
          typeof response.matchId !== 'string' ||
          typeof response.status !== 'string' ||
          typeof response.createdAt !== 'string'
        ) {
          throw new TurnurApiError(status, 'Invalid response: missing match fields');
        }

        return {
          matchId: response.matchId,
          status: response.status,
          createdAt: response.createdAt,
        };
      },
    },
  };
}
