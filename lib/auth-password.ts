import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (plain.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`);
  }
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
