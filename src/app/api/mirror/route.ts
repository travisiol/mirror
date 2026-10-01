import { ledger } from "@/server/db";
import { handle } from "@/server/http";
import { requireUser } from "@/server/session";

/** This month's mirror and the purchase history of the signed-in wallet. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    return Response.json({ month: ledger().monthView(user), history: ledger().history(user) });
  });
}
