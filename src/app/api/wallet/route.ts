import { readWallet } from "@/server/chain";
import { handle } from "@/server/http";
import { requireUser } from "@/server/session";

/** On-chain balances of the signed-in wallet. No address parameter: a session can only read itself. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    return Response.json({ wallet: await readWallet(user) });
  });
}
