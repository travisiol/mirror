import { verifyMessage } from "viem";
import { LedgerError } from "@/core/ledger";
import { signInMessage } from "@/lib/signin-message";
import { ledger } from "@/server/db";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { startUserSession } from "@/server/session";

interface Body {
  address?: string;
  nonce?: string;
  issuedAt?: string;
  signature?: string;
}

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { address, nonce, issuedAt, signature } = await readJson<Body>(request);
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new LedgerError(400, "Invalid wallet address.");
    if (!nonce || !issuedAt || !signature || !/^0x[0-9a-fA-F]+$/.test(signature))
      throw new LedgerError(400, "Incomplete sign-in request.");

    // The nonce is spent before the signature is checked, so it can never be tried twice.
    if (!ledger().consumeNonce(nonce)) throw new LedgerError(401, "That sign-in request expired. Try again.");

    // The message is rebuilt here: the client cannot choose what was signed.
    const host = request.headers.get("host") ?? "";
    const message = signInMessage({ host, address, nonce, issuedAt });
    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    }).catch(() => false);
    if (!valid) throw new LedgerError(401, "The signature does not match this wallet.");

    await startUserSession(address);
    return Response.json({ address: address.toLowerCase() });
  });
}
