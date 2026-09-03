import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "market-data/latest.json");
const allowStale = process.argv.includes("--allow-stale");
const currencies = ["USD", "GBP", "CHF"];
const labels = {
  USD: ["EURUSD", "EUR / USD", "US dollars per euro"],
  GBP: ["EURGBP", "EUR / GBP", "UK pounds per euro"],
  CHF: ["EURCHF", "EUR / CHF", "Swiss francs per euro"],
};

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function annualisedVolatility(prices, sessions) {
  const window = prices.slice(-(sessions + 1));
  if (window.length < sessions + 1) throw new Error(`Need ${sessions + 1} observations`);
  const returns = window.slice(1).map((price, index) => Math.log(price / window[index]));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * 252);
}

function round(value, digits = 8) {
  return Number(value.toFixed(digits));
}

function seriesValues(payload) {
  const seriesDimensions = payload.structure?.dimensions?.series;
  const timeDimension = payload.structure?.dimensions?.observation?.find(
    (dimension) => dimension.id === "TIME_PERIOD",
  );
  const currencyIndex = seriesDimensions?.findIndex((dimension) => dimension.id === "CURRENCY");
  const currencyDimension = seriesDimensions?.[currencyIndex];
  const series = payload.dataSets?.[0]?.series;
  if (!timeDimension || currencyIndex < 0 || !currencyDimension || !series) {
    throw new Error("ECB response does not contain the expected EXR dimensions");
  }

  return Object.entries(series).map(([key, value]) => {
    const dimensionIndexes = key.split(":").map(Number);
    const currency = currencyDimension.values[dimensionIndexes[currencyIndex]]?.id;
    const observations = Object.entries(value.observations ?? {})
      .map(([timeIndex, observation]) => ({
        date: timeDimension.values[Number(timeIndex)]?.id,
        value: Number(observation[0]),
      }))
      .filter((observation) => observation.date && Number.isFinite(observation.value))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { currency, observations };
  });
}

async function existingSnapshotIsUsable() {
  try {
    const existing = JSON.parse(await readFile(outputPath, "utf8"));
    return existing.schemaVersion === 1 && existing.instruments?.length > 0;
  } catch {
    return false;
  }
}

async function refresh() {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 190);
  const endpoint = new URL(
    `https://data-api.ecb.europa.eu/service/data/EXR/D.${currencies.join("+")}.EUR.SP00.A`,
  );
  endpoint.searchParams.set("startPeriod", isoDate(start));
  endpoint.searchParams.set("format", "jsondata");
  const response = await fetch(endpoint, {
    headers: { Accept: "application/vnd.sdmx.data+json;version=1.0.0-wd" },
  });
  if (!response.ok) throw new Error(`ECB request failed with ${response.status}`);
  const payload = await response.json();
  const instruments = seriesValues(payload).map(({ currency, observations }) => {
    if (!labels[currency]) throw new Error(`Unexpected ECB currency ${currency}`);
    if (observations.length < 61) throw new Error(`Not enough observations for ${currency}`);
    const latest = observations.at(-1);
    const prices = observations.map((observation) => observation.value);
    return {
      id: labels[currency][0],
      label: labels[currency][1],
      quoteConvention: labels[currency][2],
      spot: latest.value,
      spotAsOf: latest.date,
      realisedVolatility20: round(annualisedVolatility(prices, 20)),
      realisedVolatility60: round(annualisedVolatility(prices, 60)),
      observationCount: observations.length,
    };
  });
  instruments.sort((a, b) => a.id.localeCompare(b.id));
  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      name: "ECB Data Portal",
      url: endpoint.toString(),
      attribution: "Source: ECB statistics; realised volatility is our calculation.",
    },
    methodology:
      "Spot is the latest ECB daily reference rate. Volatility is the annualised sample standard deviation of the latest 20 or 60 daily log returns, using 252 sessions per year.",
    instruments,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
  console.log(`Wrote ${instruments.length} instruments to ${outputPath}`);
}

try {
  await refresh();
} catch (error) {
  if (allowStale && (await existingSnapshotIsUsable())) {
    console.warn(`Market refresh failed; retaining last-good snapshot: ${error.message}`);
  } else {
    throw error;
  }
}
