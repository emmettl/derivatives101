import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const bundledEntries = [
  "options-a-la-carte.html",
  "payoff-explorer.html",
  "option-lab.html",
  "solver-lab.html",
  "product-solver.html",
  "reverse-convertible-lab.html",
  "coupon-memory-lab.html",
  "lock-in-lab.html",
  "basket-lab.html",
  "participation-lab.html",
  "koda-kodd-lab.html",
  "specification-capstone.html",
  "term-sheet-decoder.html",
  "credit-liquidity.html",
  "currency-risk.html",
  "dynamic-hedging.html",
  "forward-carry.html",
  "risk-fingerprints.html",
  "stepdown-autocall.html",
  "value-before-maturity.html",
  "volatility-skew.html",
  "lesson-00-foundations.html",
  "lesson-01-koda-kodd.html",
  "lesson-02-reverse-convertibles.html",
  "lesson-03-fcn-eln.html",
  "lesson-04-discount-bonus.html",
  "lesson-05-protection-leverage.html",
  "glossary.html",
];

const buildOnly = new Set([
  "dist",
  "coverage",
  "e2e",
  "logs",
  "node_modules",
  "playwright-report",
  "playwright.config.ts",
  "src",
  "test-results",
  "README.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
]);

function copyLegacySiteAssets(): Plugin {
  return {
    name: "copy-legacy-site-assets",
    apply: "build",
    writeBundle(options) {
      const outputDirectory = resolve(projectRoot, String(options.dir ?? "dist"));
      mkdirSync(outputDirectory, { recursive: true });
      readdirSync(projectRoot).forEach((name) => {
        if (
          buildOnly.has(name) ||
          bundledEntries.includes(name) ||
          (name.startsWith(".") && name !== ".nojekyll")
        )
          return;
        const source = join(projectRoot, name);
        if (!existsSync(source)) return;
        cpSync(source, join(outputDirectory, name), { recursive: true });
      });
    },
  };
}

export default defineConfig({
  base: "./",
  publicDir: false,
  test: {
    exclude: ["e2e/**", "**/node_modules/**", "**/dist/**"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      input: Object.fromEntries(
        bundledEntries.map((name) => [name.slice(0, -5), resolve(projectRoot, name)]),
      ),
    },
  },
  plugins: [copyLegacySiteAssets()],
});
