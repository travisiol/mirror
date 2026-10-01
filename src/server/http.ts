import "server-only";
import { LedgerError } from "@/core/ledger";

/** Run a handler; turn known errors into JSON, and never echo internals. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    // Matched by name as well: after a dev hot reload the long-lived ledger can throw an older copy of the class.
    if (error instanceof LedgerError || (error instanceof Error && error.name === "LedgerError")) {
      const known = error as LedgerError;
      return Response.json(
        { error: known.message, ...(known.fields ? { fields: known.fields } : {}) },
        { status: typeof known.status === "number" ? known.status : 400 },
      );
    }
    console.error("[mirror] request failed:", error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "unknown");
    return Response.json({ error: "Something went wrong on our side." }, { status: 500 });
  }
}

/** Mutations must come from this site's own pages. */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) throw new LedgerError(403, "Cross-site request refused.");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new LedgerError(403, "Cross-site request refused.");
  }
  if (originHost !== host) throw new LedgerError(403, "Cross-site request refused.");
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new LedgerError(400, "Invalid request body.");
  }
}
