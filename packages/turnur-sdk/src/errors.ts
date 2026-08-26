export class TurnurApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly hint?: string;

  constructor(status: number, message: string, code?: string, hint?: string) {
    super(message);
    this.name = 'TurnurApiError';
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}
