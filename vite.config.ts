import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const bundledEntries = [
  "options-a-la-carte.html",
  "payoff-explorer.html",
  "option-lab.html",
  "reverse-convertible-lab.html",
  "coupon-memory-lab.html",
  "lock-in-lab.html",
  "basket-lab.html",
  "participation-lab.html",
  "koda-kodd-lab.html",
  "specification-capstone.html",
  "term-sheet-decoder.html"
];

const buildOnly = new Set([
  "dist",
  "coverage",
  "logs",
  "node_modules",
  "src",
  "README.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts"
]);

function copyLegacySiteAssets(): Plugin {
  return {
    name: "copy-legacy-site-assets",
    apply: "build",
    writeBundle(options) {
      const outputDirectory = resolve(projectRoot, String(options.dir ?? "dist"));
      mkdirSync(outputDirectory, { recursive: true });
      readdirSync(projectRoot).forEach(name => {
        if (buildOnly.has(name) || bundledEntries.includes(name) || (name.startsWith(".") && name !== ".nojekyll")) return;
        const source = join(projectRoot, name);
        if (!existsSync(source)) return;
        cpSync(source, join(outputDirectory, name), { recursive: true });
      });
    }
  };
}

export default defineConfig({
  base: "./",
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      input: Object.fromEntries(bundledEntries.map(name => [name.slice(0, -5), resolve(projectRoot, name)]))
    }
  },
  plugins: [copyLegacySiteAssets()]
});
