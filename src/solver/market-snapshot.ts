export interface MarketInstrumentSnapshot {
  id: string;
  label: string;
  quoteConvention: string;
  spot: number;
  spotAsOf: string;
  realisedVolatility20: number;
  realisedVolatility60: number;
  observationCount: number;
}

export interface MarketSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  source: {
    name: string;
    url: string;
    attribution: string;
  };
  methodology: string;
  instruments: MarketInstrumentSnapshot[];
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function parseMarketSnapshot(value: unknown): MarketSnapshot {
  if (!value || typeof value !== "object") throw new Error("Snapshot is not an object");
  const candidate = value as Partial<MarketSnapshot>;
  if (candidate.schemaVersion !== 1) throw new Error("Unsupported snapshot version");
  if (!candidate.generatedAt || !Number.isFinite(Date.parse(candidate.generatedAt))) {
    throw new Error("Snapshot has no valid generation time");
  }
  if (!candidate.source?.name || !candidate.source.url || !candidate.source.attribution) {
    throw new Error("Snapshot source metadata is incomplete");
  }
  if (!candidate.methodology || !Array.isArray(candidate.instruments)) {
    throw new Error("Snapshot content is incomplete");
  }
  candidate.instruments.forEach((instrument) => {
    if (
      !instrument.id ||
      !instrument.label ||
      !instrument.quoteConvention ||
      !isFinitePositive(instrument.spot) ||
      !isFinitePositive(instrument.realisedVolatility20) ||
      !isFinitePositive(instrument.realisedVolatility60) ||
      !Number.isInteger(instrument.observationCount) ||
      instrument.observationCount < 61 ||
      !Number.isFinite(Date.parse(instrument.spotAsOf))
    ) {
      throw new Error(`Invalid market snapshot instrument ${instrument.id || "unknown"}`);
    }
  });
  if (!candidate.instruments.length) throw new Error("Snapshot contains no instruments");
  return candidate as MarketSnapshot;
}

export async function loadMarketSnapshot(
  url: string,
  request: typeof fetch = fetch,
): Promise<MarketSnapshot> {
  const response = await request(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Snapshot request failed with ${response.status}`);
  return parseMarketSnapshot(await response.json());
}

export function marketDataAgeDays(instrument: MarketInstrumentSnapshot, now = Date.now()): number {
  return Math.max(0, (now - Date.parse(`${instrument.spotAsOf}T00:00:00.000Z`)) / 86_400_000);
}
