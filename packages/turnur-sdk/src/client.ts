import {
  authenticatedGet,
  authenticatedPost,
  authenticatedPut,
  throwStructuredError,
  throwUnauthorized,
} from './http.js';
import { TurnurApiError } from './errors.js';
import type {
  GameMeResponse,
  MatchCreateResponse,
  MatchGetResponse,
  MatchMoveCreateResponse,
  MatchMovesListResponse,
  MatchSeatCreateResponse,
  MatchSeatListResponse,
  MatchTurnResponse,
  MatchViewGetResponse,
  MatchViewPutResponse,
  TurnurClientConfig,
} from './types.js';

export type TurnurClient = {
  game: {
    me(): Promise<GameMeResponse>;
  };
  match: {
    create(): Promise<MatchCreateResponse>;
    get(matchId: string): Promise<MatchGetResponse>;
    seat: {
      create(matchId: string): Promise<MatchSeatCreateResponse>;
      list(matchId: string): Promise<MatchSeatListResponse>;
    };
    turn: {
      get(matchId: string): Promise<MatchTurnResponse>;
      set(matchId: string, seatId: string): Promise<MatchTurnResponse>;
    };
    move: {
      create(
        matchId: string,
        input: { seatId: string; payload: unknown },
      ): Promise<MatchMoveCreateResponse>;
    };
    view: {
      put(matchId: string, seatId: string, view: unknown): Promise<MatchViewPutResponse>;
      get(matchId: string, seatId: string): Promise<MatchViewGetResponse>;
    };
    moves: {
      list(matchId: string): Promise<MatchMovesListResponse>;
    };
  };
};

function handleMatchAuthorityErrors(status: number, body: unknown): void {
  if (status === 401) {
    throwUnauthorized(body);
  }
  if (status === 400 || status === 403 || status === 404 || status === 409) {
    throwStructuredError(status, body);
  }
}

function parseCurrentSeat(value: unknown, status: number): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  throw new TurnurApiError(status, 'Invalid response: invalid currentSeat');
}

function matchPath(matchId: string, suffix: string): string {
  return `/v1/matches/${encodeURIComponent(matchId)}${suffix}`;
}

function seatViewPath(matchId: string, seatId: string): string {
  return `/v1/matches/${encodeURIComponent(matchId)}/seats/${encodeURIComponent(seatId)}/view`;
}

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
        const path = matchPath(matchId, '');
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

      seat: {
        async create(matchId: string): Promise<MatchSeatCreateResponse> {
          const path = matchPath(matchId, '/seats');
          const { status, body } = await authenticatedPost(baseUrl, apiKey, path);

          handleMatchAuthorityErrors(status, body);

          if (status !== 201) {
            throw new TurnurApiError(status, `Request failed with status ${status}`);
          }

          const response = body as Record<string, unknown>;
          if (!body || typeof response.seatId !== 'string') {
            throw new TurnurApiError(status, 'Invalid response: missing seatId');
          }

          return {
            seatId: response.seatId,
            currentSeat: parseCurrentSeat(response.currentSeat, status),
          };
        },

        async list(matchId: string): Promise<MatchSeatListResponse> {
          const path = matchPath(matchId, '/seats');
          const { status, body } = await authenticatedGet(baseUrl, apiKey, path);

          handleMatchAuthorityErrors(status, body);

          if (status !== 200) {
            throw new TurnurApiError(status, `Request failed with status ${status}`);
          }

          const response = body as Record<string, unknown>;
          if (!body || !Array.isArray(response.seats)) {
            throw new TurnurApiError(status, 'Invalid response: missing seats');
          }

          const seats = response.seats.map((seat, index) => {
            const entry = seat as Record<string, unknown>;
            if (typeof entry.seatId !== 'string' || typeof entry.createdAt !== 'string') {
              throw new TurnurApiError(status, `Invalid response: invalid seat at index ${index}`);
            }
            return { seatId: entry.seatId, createdAt: entry.createdAt };
          });

          return {
            seats,
            currentSeat: parseCurrentSeat(response.currentSeat, status),
          };
        },
      },

      turn: {
        async get(matchId: string): Promise<MatchTurnResponse> {
          const path = matchPath(matchId, '/turn');
          const { status, body } = await authenticatedGet(baseUrl, apiKey, path);

          handleMatchAuthorityErrors(status, body);

          if (status !== 200) {
            throw new TurnurApiError(status, `Request failed with status ${status}`);
          }

          if (!body || !('currentSeat' in (body as object))) {
            throw new TurnurApiError(status, 'Invalid response: missing currentSeat');
          }

          return {
            currentSeat: parseCurrentSeat(
              (body as Record<string, unknown>).currentSeat,
              status,
            ),
          };
        },

        async set(matchId: string, seatId: string): Promise<MatchTurnResponse> {
          const path = matchPath(matchId, '/turn');
          const { status, body } = await authenticatedPut(baseUrl, apiKey, path, { seatId });

          handleMatchAuthorityErrors(status, body);

          if (status !== 200) {
            throw new TurnurApiError(status, `Request failed with status ${status}`);
          }

          if (!body || !('currentSeat' in (body as object))) {
            throw new TurnurApiError(status, 'Invalid response: missing currentSeat');
          }

          return {
            currentSeat: parseCurrentSeat(
              (body as Record<string, unknown>).currentSeat,
              status,
            ),
          };
        },
      },

      move: {
        async create(
          matchId: string,
          input: { seatId: string; payload: unknown },
        ): Promise<MatchMoveCreateResponse> {
          const path = matchPath(matchId, '/moves');
          const { status, body } = await authenticatedPost(baseUrl, apiKey, path, {
            seatId: input.seatId,
            payload: input.payload,
          });

          handleMatchAuthorityErrors(status, body);

          if (status !== 201) {
            throw new TurnurApiError(status, `Request failed with status ${status}`);
          }

          const response = body as Record<string, unknown>;
          if (
            !body ||
            typeof response.seq !== 'number' ||
            typeof response.seatId !== 'string' ||
            typeof response.createdAt !== 'string'
          ) {
            throw new TurnurApiError(status, 'Invalid response: missing move fields');
          }

          return {
            seq: response.seq,
            seatId: response.seatId,
            createdAt: response.createdAt,
            currentSeat: parseCurrentSeat(response.currentSeat, status),
          };
        },
      },

      view: {
        async put(
          matchId: string,
          seatId: string,
          view: unknown,
        ): Promise<MatchViewPutResponse> {
          const path = seatViewPath(matchId, seatId);
          const { status, body } = await authenticatedPut(baseUrl, apiKey, path, { view });

          handleMatchAuthorityErrors(status, body);

          if (status !== 200) {
            throw new TurnurApiError(status, `Request failed with status ${status}`);
          }

          const response = body as Record<string, unknown>;
          if (!body || typeof response.seatId !== 'string') {
            throw new TurnurApiError(status, 'Invalid response: missing seatId');
          }

          return { seatId: response.seatId };
        },

        async get(matchId: string, seatId: string): Promise<MatchViewGetResponse> {
          const path = seatViewPath(matchId, seatId);
          const { status, body } = await authenticatedGet(baseUrl, apiKey, path);

          handleMatchAuthorityErrors(status, body);

          if (status !== 200) {
            throw new TurnurApiError(status, `Request failed with status ${status}`);
          }

          const response = body as Record<string, unknown>;
          if (!body || typeof response.seatId !== 'string' || !('view' in response)) {
            throw new TurnurApiError(status, 'Invalid response: missing view fields');
          }

          return {
            seatId: response.seatId,
            view: response.view,
          };
        },
      },

      moves: {
        async list(matchId: string): Promise<MatchMovesListResponse> {
          const path = matchPath(matchId, '/moves');
          const { status, body } = await authenticatedGet(baseUrl, apiKey, path);

          handleMatchAuthorityErrors(status, body);

          if (status !== 200) {
            throw new TurnurApiError(status, `Request failed with status ${status}`);
          }

          const response = body as Record<string, unknown>;
          if (!body || !Array.isArray(response.items)) {
            throw new TurnurApiError(status, 'Invalid response: missing items');
          }

          const items = response.items.map((item, index) => {
            const entry = item as Record<string, unknown>;
            if (
              typeof entry.seq !== 'number' ||
              typeof entry.seatId !== 'string' ||
              typeof entry.createdAt !== 'string' ||
              !('payload' in entry)
            ) {
              throw new TurnurApiError(status, `Invalid response: invalid item at index ${index}`);
            }
            return {
              seq: entry.seq,
              seatId: entry.seatId,
              payload: entry.payload,
              createdAt: entry.createdAt,
            };
          });

          return { items };
        },
      },
    },
  };
}
