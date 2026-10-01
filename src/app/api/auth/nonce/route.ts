import { LedgerError } from "@/core/ledger";
import { signInMessage } from "@/lib/signin-message";
import { ledger } from "@/server/db";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { sessionsAvailable } from "@/server/session";

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    if (!sessionsAvailable()) throw new LedgerError(503, "Sign-in is not configured on this server.");
    const { address } = await readJson<{ address?: string }>(request);
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new LedgerError(400, "Invalid wallet address.");
    const issuedAt = new Date().toISOString();
    const nonce = ledger().issueNonce();
    const host = request.headers.get("host") ?? "";
    return Response.json({ nonce, issuedAt, message: signInMessage({ host, address, nonce, issuedAt }) });
  });
}
