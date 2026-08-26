import type { APIGatewayProxyResultV2 } from 'aws-lambda';

export type GameAuthErrorCode = 'game_auth_required' | 'game_auth_invalid';

export type GameAuthErrorBody = {
  code: GameAuthErrorCode;
  message: string;
  hint: string;
};

function jsonResponse(statusCode: number, body: GameAuthErrorBody): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

export function buildGameAuthRequiredResponse(): APIGatewayProxyResultV2 {
  return jsonResponse(401, {
    code: 'game_auth_required',
    message: 'Game SDK key required',
    hint: 'Send Authorization: Bearer <sdk-key> with a valid turnur_sk_ key.',
  });
}

export function buildGameAuthInvalidResponse(): APIGatewayProxyResultV2 {
  return jsonResponse(401, {
    code: 'game_auth_invalid',
    message: 'Invalid game SDK key',
    hint: 'Check the Authorization Bearer token format and that the key is registered.',
  });
}
