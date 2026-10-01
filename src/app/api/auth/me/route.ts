import { handle } from "@/server/http";
import { currentUser, sessionsAvailable } from "@/server/session";

export async function GET() {
  return handle(async () => Response.json({ address: await currentUser(), signIn: sessionsAvailable() }));
}
