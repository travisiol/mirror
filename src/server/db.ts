import "server-only";
import { DatabaseSync } from "node:sqlite";
import { accessSync, constants, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger } from "@/core/ledger";

/**
 * Where the database lives. `./data` when the disk is writable; otherwise
 * the OS temp directory, which is EPHEMERAL (serverless hosts) — the app
 * reports that state instead of pretending records persist.
 */
function resolveDataDir(): { dir: string; persistent: boolean } {
  const explicit = process.env.MIRROR_DATA_DIR;
  const candidates = explicit ? [explicit] : [join(process.cwd(), "data")];
  for (const dir of candidates) {
    try {
      mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
      accessSync(/* turbopackIgnore: true */ dir, constants.W_OK);
      return { dir, persistent: true };
    } catch {
      // fall through
    }
  }
  const dir = join(tmpdir(), "mirror");
  mkdirSync(dir, { recursive: true });
  console.warn("[mirror] data directory is not writable; using ephemeral temp storage");
  return { dir, persistent: false };
}

interface Runtime {
  ledger: Ledger;
  dataDir: string;
  persistent: boolean;
}

const globalRuntime = globalThis as unknown as { __mirror?: Runtime };

export function runtime(): Runtime {
  if (!globalRuntime.__mirror) {
    const { dir, persistent } = resolveDataDir();
    const db = new DatabaseSync(join(dir, "mirror.db"));
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 5000");
    globalRuntime.__mirror = { ledger: new Ledger(db), dataDir: dir, persistent };
  }
  return globalRuntime.__mirror;
}

export function ledger(): Ledger {
  return runtime().ledger;
}
