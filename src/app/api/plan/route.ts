import { ledger } from "@/server/db";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { requireUser } from "@/server/session";

/** The signed-in wallet's subscriptions and mirror rate. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    return Response.json({ plan: ledger().getPlan(user) });
  });
}

export async function PUT(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    // Prices and rate are validated in the ledger; nothing in the body names a wallet.
    const plan = ledger().savePlan(user, await readJson<unknown>(request));
    return Response.json({ plan });
  });
}
