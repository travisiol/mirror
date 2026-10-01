/**
 * The subscription catalogue. Each service maps to the stock token of the
 * company that sells it. A service is listed only if its ticker is a key of
 * STOCK_TOKENS in ./network.ts (enforced by tests/mirror.test.ts), and a
 * token is there only if it is in Robinhood's official list and a live
 * purchase quote exists for it (`npm run check:tokens`).
 *
 * The companies named here are not partners or sponsors of mirror.
 */
export interface Service {
  id: string;
  name: string;
  company: string;
  ticker: string;
}

export const CATALOG: Service[] = [
  { id: "netflix", name: "Netflix", company: "Netflix", ticker: "NFLX" },
  { id: "amazon-prime", name: "Amazon Prime", company: "Amazon", ticker: "AMZN" },
  { id: "youtube-premium", name: "YouTube Premium", company: "Alphabet", ticker: "GOOGL" },
  { id: "google-one", name: "Google One", company: "Alphabet", ticker: "GOOGL" },
  { id: "icloud", name: "iCloud+", company: "Apple", ticker: "AAPL" },
  { id: "apple-music", name: "Apple Music", company: "Apple", ticker: "AAPL" },
  { id: "apple-tv", name: "Apple TV+", company: "Apple", ticker: "AAPL" },
  { id: "xbox-game-pass", name: "Xbox Game Pass", company: "Microsoft", ticker: "MSFT" },
  { id: "microsoft-365", name: "Microsoft 365", company: "Microsoft", ticker: "MSFT" },
  { id: "adobe-creative-cloud", name: "Adobe Creative Cloud", company: "Adobe", ticker: "ADBE" },
  { id: "roblox-premium", name: "Roblox Premium", company: "Roblox", ticker: "RBLX" },
  { id: "zoom", name: "Zoom", company: "Zoom", ticker: "ZM" },
];

export const SERVICE_BY_ID: Record<string, Service> = Object.fromEntries(CATALOG.map((service) => [service.id, service]));

/** Companies in catalogue order, each with the services that map to it. */
export const COMPANIES: { ticker: string; company: string; services: Service[] }[] = [];
for (const service of CATALOG) {
  const existing = COMPANIES.find((entry) => entry.ticker === service.ticker);
  if (existing) existing.services.push(service);
  else COMPANIES.push({ ticker: service.ticker, company: service.company, services: [service] });
}
