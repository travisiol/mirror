/**
 * The ledger: plans, monthly purchases and sign-in nonces, on SQLite.
 * Every rule that protects a user lives here so it can be tested without
 * HTTP or a chain:
 *
 * - every row belongs to one wallet and every query is scoped to it;
 * - the amount due is computed here from the saved plan — a client never
 *   supplies it;
 * - one purchase per (wallet, month, token): UNIQUE in the schema, and a
 *   purchase that is being signed, is submitted or is confirmed blocks a
 *   second one;
 * - a purchase is confirmed only by what the chain says about its
 *   transaction, and one transaction can settle one purchase (UNIQUE hash).
 */
import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { COMPANIES } from "../config/catalog.ts";
import { DROPPED_AFTER_MS, MIN_ORDER_MICRO, SIGNING_LOCK_MS } from "../config/mirror-policy.ts";
import { STOCK_TOKENS } from "../config/network.ts";
import { computeMirror, formatUsd, monthKey, validatePlan } from "./mirror.ts";
import type { MirrorPart, Plan } from "./mirror.ts";

export class LedgerError extends Error {
  status: number;
  fields?: Record<string, string>;
  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "LedgerError";
    this.status = status;
    this.fields = fields;
  }
}

/** What the ledger needs from the chain. The server provides the real one. */
export interface ChainAdapter {
  /** Look a submitted purchase transaction up, after the required confirmations. */
  inspect(
    txHash: string,
    expected: { wallet: string; ticker: string; amountMicro: bigint },
  ): Promise<
    | { state: "confirmed"; tokenRaw: bigint; usdgSpent: bigint; block: number; uiMultiplier: bigint }
    | { state: "pending" }
    | { state: "unknown" }
    | { state: "failed"; reason: string }
  >;
}

export type LineStatus = "due" | "too-small" | "signing" | "submitted" | "confirmed";

/** JSON-safe: amounts are decimal strings of base units. */
export interface PartView {
  serviceId: string;
  name: string;
  priceCents: number;
  amountMicro: string;
}

export interface LineView {
  ticker: string;
  company: string;
  status: LineStatus;
  amountMicro: string;
  rateBps: number;
  parts: PartView[];
  txHash: string | null;
  tokenRaw: string | null;
  usdgSpent: string | null;
  lockExpiresAt: number | null;
  confirmedAt: number | null;
}

export interface MonthView {
  month: string;
  rateBps: number | null;
  lines: LineView[];
  /** Sum of the lines still to buy this month. */
  dueMicro: string;
}

export interface HistoryEntry {
  id: string;
  month: string;
  ticker: string;
  company: string;
  /** "pending": submitted in an earlier month and not settled yet. */
  outcome: "confirmed" | "failed" | "pending";
  usdgSpent: string | null;
  tokenRaw: string | null;
  uiMultiplier: string | null;
  txHash: string;
  block: number | null;
  at: number;
  reason: string | null;
}

interface PurchaseRow {
  id: string;
  wallet: string;
  month: string;
  ticker: string;
  amount_micro: string;
  rate_bps: number;
  parts: string;
  status: "signing" | "submitted" | "confirmed";
  tx_hash: string | null;
  token_raw: string | null;
  usdg_spent: string | null;
  ui_multiplier: string | null;
  block: number | null;
  lock_expires_at: number | null;
  created_at: number;
  submitted_at: number | null;
  confirmed_at: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
  wallet TEXT PRIMARY KEY,
  rate_bps INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  wallet TEXT NOT NULL,
  service_id TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  PRIMARY KEY (wallet, service_id)
);
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  month TEXT NOT NULL,
  ticker TEXT NOT NULL,
  amount_micro TEXT NOT NULL,
  rate_bps INTEGER NOT NULL,
  parts TEXT NOT NULL,
  status TEXT NOT NULL,
  tx_hash TEXT UNIQUE,
  token_raw TEXT,
  usdg_spent TEXT,
  ui_multiplier TEXT,
  block INTEGER,
  lock_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  submitted_at INTEGER,
  confirmed_at INTEGER,
  UNIQUE (wallet, month, ticker)
);
CREATE TABLE IF NOT EXISTS failed_attempts (
  tx_hash TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  month TEXT NOT NULL,
  ticker TEXT NOT NULL,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS purchases_wallet ON purchases(wallet, month);
`;

const NONCE_TTL_MS = 10 * 60_000;
const companyOf = (ticker: string) => COMPANIES.find((c) => c.ticker === ticker)?.company ?? ticker;
const partViews = (parts: MirrorPart[]): PartView[] => parts.map((p) => ({ ...p, amountMicro: p.amountMicro.toString() }));

export class Ledger {
  private db: DatabaseSync;
  private clock: () => number;

  constructor(db: DatabaseSync, clock: () => number = Date.now) {
    this.db = db;
    this.clock = clock;
    db.exec(SCHEMA);
  }

  // ───────────────────────────── sign-in nonces

  issueNonce(): string {
    const now = this.clock();
    this.db.prepare("DELETE FROM nonces WHERE expires_at < ?").run(now);
    const nonce = randomBytes(16).toString("hex");
    this.db.prepare("INSERT INTO nonces (nonce, expires_at) VALUES (?, ?)").run(nonce, now + NONCE_TTL_MS);
    return nonce;
  }

  /** True exactly once per issued nonce. */
  consumeNonce(nonce: string): boolean {
    const result = this.db.prepare("DELETE FROM nonces WHERE nonce = ? AND expires_at >= ?").run(nonce, this.clock());
    return result.changes === 1;
  }

  // ───────────────────────────── plan

  getPlan(wallet: string): { rateBps: number | null; subscriptions: { serviceId: string; priceCents: number }[] } {
    const owner = wallet.toLowerCase();
    const plan = this.db.prepare("SELECT rate_bps FROM plans WHERE wallet = ?").get(owner) as { rate_bps: number } | undefined;
    const rows = this.db
      .prepare("SELECT service_id, price_cents FROM subscriptions WHERE wallet = ? ORDER BY rowid")
      .all(owner) as { service_id: string; price_cents: number }[];
    return {
      rateBps: plan?.rate_bps ?? null,
      subscriptions: rows.map((row) => ({ serviceId: row.service_id, priceCents: row.price_cents })),
    };
  }

  /** Replace the wallet's plan. Input is untrusted. */
  savePlan(wallet: string, input: unknown) {
    const owner = wallet.toLowerCase();
    let plan: Plan;
    try {
      plan = validatePlan(input);
    } catch (error) {
      const fields = (error as { fields?: Record<string, string> }).fields;
      throw new LedgerError(400, (error as Error).message, fields);
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("INSERT INTO plans (wallet, rate_bps, updated_at) VALUES (?, ?, ?) ON CONFLICT(wallet) DO UPDATE SET rate_bps = excluded.rate_bps, updated_at = excluded.updated_at")
        .run(owner, plan.rateBps, this.clock());
      this.db.prepare("DELETE FROM subscriptions WHERE wallet = ?").run(owner);
      const insert = this.db.prepare("INSERT INTO subscriptions (wallet, service_id, price_cents) VALUES (?, ?, ?)");
      for (const subscription of plan.subscriptions) insert.run(owner, subscription.serviceId, subscription.priceCents);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getPlan(owner);
  }

  // ───────────────────────────── this month

  private rows(wallet: string, month: string): PurchaseRow[] {
    return this.db.prepare("SELECT * FROM purchases WHERE wallet = ? AND month = ?").all(wallet, month) as unknown as PurchaseRow[];
  }

  private row(wallet: string, month: string, ticker: string): PurchaseRow | undefined {
    return this.db.prepare("SELECT * FROM purchases WHERE wallet = ? AND month = ? AND ticker = ?").get(wallet, month, ticker) as
      | PurchaseRow
      | undefined;
  }

  /** A signing lock that ran out without a transaction hash frees the purchase again. */
  private live(row: PurchaseRow | undefined): PurchaseRow | undefined {
    if (row && row.status === "signing" && (row.lock_expires_at ?? 0) <= this.clock()) {
      this.db.prepare("DELETE FROM purchases WHERE id = ? AND status = 'signing'").run(row.id);
      return undefined;
    }
    return row;
  }

  monthView(wallet: string): MonthView {
    const owner = wallet.toLowerCase();
    const month = monthKey(this.clock());
    const plan = this.getPlan(owner);
    const mirror = computeMirror({ rateBps: plan.rateBps ?? 0, subscriptions: plan.subscriptions });
    const rows = this.rows(owner, month).map((row) => this.live(row)).filter((row): row is PurchaseRow => !!row);

    const lines: LineView[] = [];
    let due = BigInt(0);
    for (const company of COMPANIES) {
      const row = rows.find((r) => r.ticker === company.ticker);
      if (row) {
        // A started purchase keeps the amount it was started with.
        lines.push({
          ticker: row.ticker,
          company: company.company,
          status: row.status,
          amountMicro: row.amount_micro,
          rateBps: row.rate_bps,
          parts: JSON.parse(row.parts) as PartView[],
          txHash: row.tx_hash,
          tokenRaw: row.token_raw,
          usdgSpent: row.usdg_spent,
          lockExpiresAt: row.status === "signing" ? row.lock_expires_at : null,
          confirmedAt: row.confirmed_at,
        });
        continue;
      }
      const line = mirror.lines.find((l) => l.ticker === company.ticker);
      if (!line || plan.rateBps === null) continue;
      if (!line.belowMinimum) due += line.amountMicro;
      lines.push({
        ticker: line.ticker,
        company: line.company,
        status: line.belowMinimum ? "too-small" : "due",
        amountMicro: line.amountMicro.toString(),
        rateBps: plan.rateBps,
        parts: partViews(line.parts),
        txHash: null,
        tokenRaw: null,
        usdgSpent: null,
        lockExpiresAt: null,
        confirmedAt: null,
      });
    }
    return { month, rateBps: plan.rateBps, lines, dueMicro: due.toString() };
  }

  /**
   * Reserve this month's purchase of one token and return the exact amount
   * to buy. Refuses if one is already being signed, submitted or confirmed.
   */
  begin(wallet: string, ticker: string): { month: string; amountMicro: bigint } {
    const owner = wallet.toLowerCase();
    if (!STOCK_TOKENS[ticker]) throw new LedgerError(404, "That token is not in the catalogue.");
    const month = monthKey(this.clock());
    const plan = this.getPlan(owner);
    if (plan.rateBps === null) throw new LedgerError(409, "Set up your subscriptions and mirror rate first.");
    const line = computeMirror({ rateBps: plan.rateBps, subscriptions: plan.subscriptions }).lines.find((l) => l.ticker === ticker);
    if (!line) throw new LedgerError(409, "None of your subscriptions maps to that token.");
    if (line.amountMicro < MIN_ORDER_MICRO)
      throw new LedgerError(409, `${formatUsd(line.amountMicro)} is below the smallest order (${formatUsd(MIN_ORDER_MICRO)}).`);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.live(this.row(owner, month, ticker));
      if (existing) {
        const message =
          existing.status === "confirmed"
            ? `This month's ${ticker} mirror is already bought.`
            : existing.status === "submitted"
              ? `This month's ${ticker} purchase is already on its way.`
              : `A ${ticker} purchase is waiting for a signature. Finish or cancel it first.`;
        throw new LedgerError(409, message);
      }
      const now = this.clock();
      this.db
        .prepare(
          "INSERT INTO purchases (id, wallet, month, ticker, amount_micro, rate_bps, parts, status, lock_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'signing', ?, ?)",
        )
        .run(`p_${randomBytes(9).toString("hex")}`, owner, month, ticker, line.amountMicro.toString(), plan.rateBps, JSON.stringify(partViews(line.parts)), now + SIGNING_LOCK_MS, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { month, amountMicro: line.amountMicro };
  }

  /** Give up a purchase that was never sent (the wallet declined, the quote failed). */
  cancel(wallet: string, month: string, ticker: string) {
    const owner = wallet.toLowerCase();
    this.db.prepare("DELETE FROM purchases WHERE wallet = ? AND month = ? AND ticker = ? AND status = 'signing'").run(owner, month, ticker);
  }

  /** Record the transaction the wallet sent. From here only the chain decides. */
  submit(wallet: string, month: string, ticker: string, txHash: string) {
    const owner = wallet.toLowerCase();
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new LedgerError(400, "Invalid transaction hash.");
    const hash = txHash.toLowerCase();
    // Not `live()`: a hash that arrives after the lock ran out is still the truth.
    const row = this.row(owner, month, ticker);
    if (!row) throw new LedgerError(409, "There is no purchase waiting for a transaction.");
    if (row.status !== "signing") throw new LedgerError(409, "This purchase already has a transaction.");
    const used =
      this.db.prepare("SELECT 1 FROM purchases WHERE tx_hash = ?").get(hash) ?? this.db.prepare("SELECT 1 FROM failed_attempts WHERE tx_hash = ?").get(hash);
    if (used) throw new LedgerError(409, "That transaction is already recorded.");
    this.db
      .prepare("UPDATE purchases SET status = 'submitted', tx_hash = ?, submitted_at = ?, lock_expires_at = NULL WHERE id = ? AND status = 'signing'")
      .run(hash, this.clock(), row.id);
  }

  /** Ask the chain about a submitted purchase and record what it says. */
  async confirm(wallet: string, month: string, ticker: string, chain: ChainAdapter): Promise<LineStatus> {
    const owner = wallet.toLowerCase();
    const row = this.row(owner, month, ticker);
    if (!row) throw new LedgerError(404, "No purchase to confirm.");
    if (row.status === "confirmed") return "confirmed";
    if (row.status !== "submitted" || !row.tx_hash) return row.status;

    const outcome = await chain.inspect(row.tx_hash, { wallet: owner, ticker, amountMicro: BigInt(row.amount_micro) });
    if (outcome.state === "confirmed") {
      this.db
        .prepare(
          "UPDATE purchases SET status = 'confirmed', token_raw = ?, usdg_spent = ?, ui_multiplier = ?, block = ?, confirmed_at = ? WHERE id = ? AND status = 'submitted'",
        )
        .run(outcome.tokenRaw.toString(), outcome.usdgSpent.toString(), outcome.uiMultiplier.toString(), outcome.block, this.clock(), row.id);
      return "confirmed";
    }
    const dropped = outcome.state === "unknown" && this.clock() - (row.submitted_at ?? 0) > DROPPED_AFTER_MS;
    if (outcome.state === "failed" || dropped) {
      const reason = outcome.state === "failed" ? outcome.reason : "The network never saw this transaction.";
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db
          .prepare("INSERT OR IGNORE INTO failed_attempts (tx_hash, wallet, month, ticker, reason, at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(row.tx_hash, owner, month, ticker, reason, this.clock());
        this.db.prepare("DELETE FROM purchases WHERE id = ?").run(row.id);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      return "due";
    }
    return "submitted";
  }

  // ───────────────────────────── history

  history(wallet: string): HistoryEntry[] {
    const owner = wallet.toLowerCase();
    // A purchase submitted just before a month ended still has to be settled: it shows as pending.
    const done = this.db
      .prepare("SELECT * FROM purchases WHERE wallet = ? AND (status = 'confirmed' OR (status = 'submitted' AND month <> ?))")
      .all(owner, monthKey(this.clock())) as unknown as PurchaseRow[];
    const failed = this.db.prepare("SELECT * FROM failed_attempts WHERE wallet = ?").all(owner) as unknown as {
      tx_hash: string;
      month: string;
      ticker: string;
      reason: string;
      at: number;
    }[];
    const entries: HistoryEntry[] = [
      ...done.map((row) => ({
        id: row.id,
        month: row.month,
        ticker: row.ticker,
        company: companyOf(row.ticker),
        outcome: row.status === "confirmed" ? ("confirmed" as const) : ("pending" as const),
        usdgSpent: row.usdg_spent,
        tokenRaw: row.token_raw,
        uiMultiplier: row.ui_multiplier,
        txHash: row.tx_hash as string,
        block: row.block,
        at: row.confirmed_at ?? row.submitted_at ?? row.created_at,
        reason: null,
      })),
      ...failed.map((row) => ({
        id: row.tx_hash,
        month: row.month,
        ticker: row.ticker,
        company: companyOf(row.ticker),
        outcome: "failed" as const,
        usdgSpent: null,
        tokenRaw: null,
        uiMultiplier: null,
        txHash: row.tx_hash,
        block: null,
        at: row.at,
        reason: row.reason,
      })),
    ];
    return entries.sort((a, b) => b.at - a.at);
  }
}
