import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cookies } from "next/headers";
import { LedgerError } from "@/core/ledger";
import { runtime } from "./db";

const USER_COOKIE = "mirror_session";
const USER_TTL_MS = 7 * 86_400_000;

/**
 * Cookie signing key. Production must set SESSION_SECRET. In development a
 * key is generated once and kept in the data directory so sessions survive
 * restarts.
 */
function secret(): string | null {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (process.env.NODE_ENV === "production") return null;
  const file = join(runtime().dataDir, ".dev-session-secret");
  if (existsSync(file)) return readFileSync(file, "utf8");
  const generated = randomBytes(32).toString("hex");
  writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

export function sessionsAvailable(): boolean {
  return secret() !== null;
}

function sign(payload: object): string {
  const key = secret();
  if (!key) throw new LedgerError(503, "Sign-in is not configured on this server.");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify<T extends { exp: number }>(token: string | undefined): T | null {
  const key = secret();
  if (!key || !token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", key).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export async function startUserSession(address: string) {
  const jar = await cookies();
  jar.set(USER_COOKIE, sign({ sub: address.toLowerCase(), exp: Date.now() + USER_TTL_MS }), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(USER_TTL_MS / 1000),
  });
}

export async function endUserSession() {
  (await cookies()).delete(USER_COOKIE);
}

export async function currentUser(): Promise<string | null> {
  const jar = await cookies();
  return verify<{ sub: string; exp: number }>(jar.get(USER_COOKIE)?.value)?.sub ?? null;
}

/** The signed-in wallet. Every data route starts here: there is no other way to name a wallet. */
export async function requireUser(): Promise<string> {
  const user = await currentUser();
  if (!user) throw new LedgerError(401, "Sign in with your wallet first.");
  return user;
}
