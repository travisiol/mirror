import { assertSameOrigin, handle } from "@/server/http";
import { endUserSession } from "@/server/session";

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    await endUserSession();
    return Response.json({ ok: true });
  });
}
