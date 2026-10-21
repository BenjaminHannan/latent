export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);

export function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function str(
  obj: Record<string, unknown>,
  key: string,
  opts: { min?: number; max: number; optional?: boolean; trim?: boolean },
): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (opts.optional) return undefined;
    throw badRequest(`${key} is required`);
  }
  if (typeof v !== 'string') throw badRequest(`${key} must be a string`);
  const s = opts.trim === false ? v : v.trim();
  const min = opts.min ?? 0;
  if (s.length < min) throw badRequest(min === 1 ? `${key} must not be empty` : `${key} must be at least ${min} characters`);
  if (s.length > opts.max) throw badRequest(`${key} must be at most ${opts.max} characters`);
  return s;
}

export function num(
  obj: Record<string, unknown>,
  key: string,
  opts: { min: number; max: number; integer?: boolean; optional?: boolean },
): number | undefined {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (opts.optional) return undefined;
    throw badRequest(`${key} is required`);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw badRequest(`${key} must be a number`);
  if (opts.integer && !Number.isInteger(v)) throw badRequest(`${key} must be an integer`);
  if (v < opts.min || v > opts.max) throw badRequest(`${key} must be between ${opts.min} and ${opts.max}`);
  return v;
}

export function oneOf<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  optional = false,
): T | undefined {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (optional) return undefined;
    throw badRequest(`${key} is required`);
  }
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw badRequest(`${key} must be one of: ${allowed.join(', ')}`);
  }
  return v as T;
}

export function isoDate(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string') throw badRequest(`${key} is required and must be an ISO date string`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`${key} must be a valid ISO date string`);
  return d.toISOString();
}

export const nowIso = () => new Date().toISOString();

import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wrap an async handler so rejections reach the error middleware (Express 4). */
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res, next))
      .catch(next);
  };
