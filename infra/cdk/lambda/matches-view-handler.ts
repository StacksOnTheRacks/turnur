/**
 * PUT /v1/matches/{matchId}/seats/{seatId}/view — write opaque hidden view for one seat.
 * GET /v1/matches/{matchId}/seats/{seatId}/view — read that seat's hidden view only.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { requireGameAuth } from '../lib/game-auth/require-game-auth';

export type PutViewResponseBody = {
  seatId: string;
};

export type GetViewResponseBody = {
  seatId: string;
  view: unknown;
};

type MatchErrorCode = 'match_not_found' | 'match_forbidden';

type MatchErrorBody = {
  code: MatchErrorCode;
  message: string;
  hint: string;
};

type InvalidRequestBody = {
  code: 'invalid_request';
  message: string;
  hint: string;
};

type SeatNotFoundBody = {
  code: 'seat_not_found';
  message: string;
  hint: string;
};

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function matchErrorResponse(
  statusCode: number,
  body: MatchErrorBody,
): APIGatewayProxyResultV2 {
  return jsonResponse(statusCode, body);
}

function buildMatchNotFoundResponse(): APIGatewayProxyResultV2 {
  return matchErrorResponse(404, {
    code: 'match_not_found',
    message: 'Match not found',
    hint: 'Verify the matchId exists and was created via POST /v1/matches for your game.',
  });
}

function buildMatchForbiddenResponse(): APIGatewayProxyResultV2 {
  return matchErrorResponse(403, {
    code: 'match_forbidden',
    message: 'Match belongs to another game',
    hint: 'Use the SDK key for the game that created this match.',
  });
}

function buildInvalidRequestResponse(): APIGatewayProxyResultV2 {
  const body: InvalidRequestBody = {
    code: 'invalid_request',
    message: 'Invalid request',
    hint: 'Provide a view in the request body.',
  };
  return jsonResponse(400, body);
}

function buildSeatNotFoundResponse(): APIGatewayProxyResultV2 {
  const body: SeatNotFoundBody = {
    code: 'seat_not_found',
    message: 'Seat not found',
    hint: 'Create the seat via POST /v1/matches/{matchId}/seats before writing or reading a view.',
  };
  return jsonResponse(404, body);
}

function parsePathSeatId(seatId: string | undefined): string | null {
  if (seatId === undefined) {
    return null;
  }
  const trimmed = seatId.trim();
  if (trimmed === '') {
    return null;
  }
  return trimmed;
}

function parseViewBody(body: string | undefined): unknown | null {
  if (body === undefined || body === '') {
    return null;
  }
  try {
    const parsed = JSON.parse(body) as { view?: unknown };
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    if (!('view' in parsed) || parsed.view === null || parsed.view === undefined) {
      return null;
    }
    return parsed.view;
  } catch {
    return null;
  }
}

async function assertMatchOwnership(
  docClient: DynamoDBDocumentClient,
  matchRegistryTable: string,
  matchId: string,
  gameId: string,
): Promise<APIGatewayProxyResultV2 | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: matchRegistryTable,
      Key: { matchId },
    }),
  );

  if (!result.Item) {
    return buildMatchNotFoundResponse();
  }

  if (result.Item.gameId !== gameId) {
    return buildMatchForbiddenResponse();
  }

  return null;
}

async function assertSeatExists(
  docClient: DynamoDBDocumentClient,
  matchStateTable: string,
  matchId: string,
  seatId: string,
): Promise<boolean> {
  const seatResult = await docClient.send(
    new GetCommand({
      TableName: matchStateTable,
      Key: { matchId, sk: `SEAT#${seatId}` },
    }),
  );
  return seatResult.Item !== undefined;
}

async function handlePutView(
  docClient: DynamoDBDocumentClient,
  matchStateTable: string,
  matchId: string,
  seatId: string,
  body: string | undefined,
): Promise<APIGatewayProxyResultV2> {
  const view = parseViewBody(body);
  if (view === null) {
    return buildInvalidRequestResponse();
  }

  const pathSeatId = parsePathSeatId(seatId);
  if (pathSeatId === null) {
    return buildSeatNotFoundResponse();
  }

  const seatExists = await assertSeatExists(docClient, matchStateTable, matchId, pathSeatId);
  if (!seatExists) {
    return buildSeatNotFoundResponse();
  }

  await docClient.send(
    new PutCommand({
      TableName: matchStateTable,
      Item: {
        matchId,
        sk: `VIEW#${pathSeatId}`,
        view,
      },
    }),
  );

  const responseBody: PutViewResponseBody = { seatId: pathSeatId };
  return jsonResponse(200, responseBody);
}

async function handleGetView(
  docClient: DynamoDBDocumentClient,
  matchStateTable: string,
  matchId: string,
  seatId: string,
): Promise<APIGatewayProxyResultV2> {
  const pathSeatId = parsePathSeatId(seatId);
  if (pathSeatId === null) {
    return buildSeatNotFoundResponse();
  }

  const seatExists = await assertSeatExists(docClient, matchStateTable, matchId, pathSeatId);
  if (!seatExists) {
    return buildSeatNotFoundResponse();
  }

  const viewResult = await docClient.send(
    new GetCommand({
      TableName: matchStateTable,
      Key: { matchId, sk: `VIEW#${pathSeatId}` },
    }),
  );

  const responseBody: GetViewResponseBody = {
    seatId: pathSeatId,
    view: viewResult.Item?.view ?? null,
  };
  return jsonResponse(200, responseBody);
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireGameAuth(event);
  if (!auth.ok) {
    return auth.response;
  }

  const matchId = event.pathParameters?.matchId;
  if (!matchId) {
    return buildMatchNotFoundResponse();
  }

  const matchRegistryTable = process.env.MATCH_REGISTRY_TABLE_NAME;
  const matchStateTable = process.env.MATCH_STATE_TABLE_NAME;
  if (!matchRegistryTable) {
    throw new Error('MATCH_REGISTRY_TABLE_NAME is not configured');
  }
  if (!matchStateTable) {
    throw new Error('MATCH_STATE_TABLE_NAME is not configured');
  }

  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const ownershipError = await assertMatchOwnership(
    docClient,
    matchRegistryTable,
    matchId,
    auth.context.gameId,
  );
  if (ownershipError) {
    return ownershipError;
  }

  const method = event.requestContext.http.method;
  const seatId = event.pathParameters?.seatId;

  if (method === 'PUT') {
    return handlePutView(docClient, matchStateTable, matchId, seatId ?? '', event.body);
  }

  if (method === 'GET') {
    return handleGetView(docClient, matchStateTable, matchId, seatId ?? '');
  }

  return jsonResponse(405, { message: 'Method Not Allowed' });
};
