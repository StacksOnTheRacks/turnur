import { TurnurApiError } from './errors.js';
import type { ApiErrorBody } from './types.js';

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export async function authenticatedGet(
  baseUrl: string,
  apiKey: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  let body: unknown;
  const text = await response.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  return { status: response.status, body };
}

export function throwUnauthorized(body: unknown): never {
  const err = (body ?? {}) as ApiErrorBody;
  throw new TurnurApiError(
    401,
    err.message ?? 'Unauthorized',
    err.code,
    err.hint,
  );
}
