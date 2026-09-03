import { describe, expect, it, vi } from "vitest";
import {
  loadMarketSnapshot,
  marketDataAgeDays,
  parseMarketSnapshot,
  type MarketSnapshot,
} from "./market-snapshot";

const validSnapshot: MarketSnapshot = {
  schemaVersion: 1,
  generatedAt: "2026-09-03T12:00:00.000Z",
  source: {
    name: "ECB Data Portal",
    url: "https://data-api.ecb.europa.eu/",
    attribution: "Source: ECB statistics; volatility is our calculation.",
  },
  methodology: "Annualised sample standard deviation of daily log returns.",
  instruments: [
    {
      id: "EURUSD",
      label: "EUR / USD",
      quoteConvention: "US dollars per euro",
      spot: 1.1578,
      spotAsOf: "2026-09-03",
      realisedVolatility20: 0.0612,
      realisedVolatility60: 0.0741,
      observationCount: 108,
    },
  ],
};

describe("market snapshot", () => {
  it("accepts a complete versioned snapshot", () => {
    expect(parseMarketSnapshot(validSnapshot).instruments[0].spot).toBe(1.1578);
  });

  it("rejects stale shapes and invalid observations", () => {
    expect(() => parseMarketSnapshot({ ...validSnapshot, schemaVersion: 2 })).toThrow(
      "Unsupported snapshot version",
    );
    expect(() =>
      parseMarketSnapshot({
        ...validSnapshot,
        instruments: [{ ...validSnapshot.instruments[0], realisedVolatility60: 0 }],
      }),
    ).toThrow("Invalid market snapshot instrument");
  });

  it("loads without relying on cross-origin browser access", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify(validSnapshot)));
    const snapshot = await loadMarketSnapshot("./market-data/latest.json", request);
    expect(request).toHaveBeenCalledWith("./market-data/latest.json", { cache: "no-store" });
    expect(snapshot.instruments[0].id).toBe("EURUSD");
  });

  it("reports snapshot age", () => {
    expect(
      marketDataAgeDays(validSnapshot.instruments[0], Date.parse("2026-09-05T00:00:00.000Z")),
    ).toBe(2);
  });
});
