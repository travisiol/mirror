import { readPrices } from "@/server/chain";
import { handle } from "@/server/http";

/** Public token prices from Robinhood's Stock Token API, each with its own timestamp. */
export async function GET() {
  return handle(async () => Response.json({ prices: await readPrices() }));
}
