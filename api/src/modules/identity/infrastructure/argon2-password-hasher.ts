import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { PasswordHasher } from '../domain/password-hasher.js';

/**
 * Argon2id password hashing. Verification is constant-time inside the library;
 * callers must still return identical error shapes for unknown users and wrong
 * passwords so the two cases are indistinguishable over the wire.
 */
@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // Malformed stored hashes fail closed rather than throwing.
      return false;
    }
  }
}
