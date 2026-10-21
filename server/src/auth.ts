import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from './db.js';
import { HttpError } from './util.js';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_color: string;
  weekly_goal_min: number;
  password_hash: string;
  password_salt: string;
  created_at: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return { hash: hash.toString('hex'), salt: salt.toString('hex') };
}

export async function verifyPassword(password: string, hashHex: string, saltHex: string): Promise<boolean> {
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export const newToken = () => crypto.randomBytes(32).toString('hex');

const PALETTE = [
  '#FF5A1F', '#F59E0B', '#10B981', '#06B6D4', '#3B82F6',
  '#8B5CF6', '#EC4899', '#EF4444', '#14B8A6', '#84CC16',
];
export const randomAvatarColor = () => PALETTE[crypto.randomInt(PALETTE.length)]!;

export function requireAuth(db: Db) {
  const stmt = db.prepare(
    'SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?',
  );
  return (req: Request, _res: Response, next: NextFunction) => {
    const m = /^Bearer\s+([A-Za-z0-9]+)\s*$/i.exec(req.headers.authorization ?? '');
    if (!m) return next(new HttpError(401, 'Authentication required'));
    const user = stmt.get(m[1]!) as UserRow | undefined;
    if (!user) return next(new HttpError(401, 'Invalid or expired token'));
    req.user = user;
    next();
  };
}
