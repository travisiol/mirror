import { STOCK_TOKENS } from "@/config/network";
import { LedgerError } from "@/core/ledger";
import { chainAdapter, fetchQuote } from "@/server/chain";
import { ledger } from "@/server/db";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { requireUser } from "@/server/session";

interface Body {
  action?: "quote" | "submit" | "confirm" | "cancel";
  month?: string;
  txHash?: string;
}

/**
 * One month's purchase of one token, step by step:
 *   quote   → reserve the purchase and return a checked swap for the exact amount due
 *   submit  → record the transaction hash the wallet returned
 *   confirm → ask the chain; only a confirmed, matching transaction marks it bought
 *   cancel  → release a purchase that was never sent
 * The amount always comes from the ledger. The server signs and sends nothing.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/mirror/[ticker]">) {
  return handle(async () => {
    assertSameOrigin(request);
    const user = await requireUser();
    const { ticker } = await ctx.params;
    if (!Object.hasOwn(STOCK_TOKENS, ticker)) throw new LedgerError(404, "That token is not in the catalogue.");
    const { action, month, txHash } = await readJson<Body>(request);
    const book = ledger();

    if (action === "quote") {
      const reserved = book.begin(user, ticker);
      try {
        const swap = await fetchQuote({ wallet: user, ticker, amountMicro: reserved.amountMicro });
        return Response.json({ month: reserved.month, amountMicro: reserved.amountMicro.toString(), swap });
      } catch (error) {
        book.cancel(user, reserved.month, ticker);
        throw error;
      }
    }

    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new LedgerError(400, "Invalid month.");

    if (action === "submit") {
      book.submit(user, month, ticker, txHash ?? "");
      return Response.json({ month: book.monthView(user) });
    }
    if (action === "confirm") {
      const status = await book.confirm(user, month, ticker, chainAdapter);
      return Response.json({ status, month: book.monthView(user), history: book.history(user) });
    }
    if (action === "cancel") {
      book.cancel(user, month, ticker);
      return Response.json({ month: book.monthView(user) });
    }
    throw new LedgerError(400, "Unknown action.");
  });
}
