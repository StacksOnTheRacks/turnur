import type { APIGatewayProxyResultV2 } from 'aws-lambda';

export type GameAuthContext = {
  gameId: string;
};

export type GameAuthResult =
  | { ok: true; context: GameAuthContext }
  | { ok: false; response: APIGatewayProxyResultV2 };
