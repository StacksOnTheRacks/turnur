/**
 * GET /v1/game/me — authenticated probe; returns stable gameId for valid SDK keys.
 */
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

import { requireGameAuth } from '../lib/game-auth/require-game-auth';

export type GameMeResponseBody = { gameId: string };

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireGameAuth(event);
  if (!auth.ok) {
    return auth.response;
  }

  const body: GameMeResponseBody = { gameId: auth.context.gameId };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
};
