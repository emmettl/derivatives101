import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const typedEntry = "options-a-la-carte.html";

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
        if (buildOnly.has(name) || name === typedEntry || (name.startsWith(".") && name !== ".nojekyll")) return;
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
    rolldownOptions: { input: resolve(projectRoot, typedEntry) }
  },
  plugins: [copyLegacySiteAssets()]
});
