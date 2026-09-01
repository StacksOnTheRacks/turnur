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

export async function authenticatedPost(
  baseUrl: string,
  apiKey: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };

  const init: RequestInit = { method: 'POST', headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);

  let responseBody: unknown;
  const text = await response.text();
  try {
    responseBody = text ? JSON.parse(text) : null;
  } catch {
    responseBody = null;
  }

  return { status: response.status, body: responseBody };
}

export async function authenticatedPut(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  let responseBody: unknown;
  const text = await response.text();
  try {
    responseBody = text ? JSON.parse(text) : null;
  } catch {
    responseBody = null;
  }

  return { status: response.status, body: responseBody };
}

export function throwStructuredError(status: number, body: unknown): never {
  const err = (body ?? {}) as ApiErrorBody;
  throw new TurnurApiError(
    status,
    err.message ?? `Request failed with status ${status}`,
    err.code,
    err.hint,
  );
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
