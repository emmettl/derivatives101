# Derivatives 101

An independent, generally useful short course in options and structured products.

## Course contents

- Six concise lesson decks, from option foundations to protection and leverage
- An interactive payoff explorer covering eight product families
- An Option Lab for value surfaces, Greeks and Monte Carlo paths
- Seventeen path-by-path, strategy, design, valuation and specification labs for multi-leg vanilla and barrier options, participation products, accumulators, decumulators, reverse convertibles, step-down autocalls, baskets, conditional coupons, memory, lock-in features, early-exit value, structured-product Greeks, dynamic hedging, volatility skew, forward pricing and carry, cross-currency and quanto payoffs, issuer credit, liquidity, term-sheet analysis and a full requirements capstone
- Guided teaching scenarios and shareable setups
- Three fictional specimen term sheets for discussion and practice
- A single PDF containing the full lesson series

## Website

The course is published at [emmettl.github.io/derivatives101](https://emmettl.github.io/derivatives101/).

Every push to `main` builds and publishes the multi-page site through GitHub Pages. `index.html` is the course home, `payoff-explorer.html` is the quick payoff explorer, and `structured-products.html` is the entry point for the lifecycle labs. The richer interactive pages use Vite module entry points under `src/`; simpler lesson pages remain dependency-free browser JavaScript.

Run `npm install` once, then use `npm run dev` for local development and `npm run build` for a type-checked production bundle plus the complete site. `npm run check` verifies Oxfmt formatting, runs Oxlint, checks TypeScript and executes the financial-engine tests. Use `npm run format` and `npm run lint:fix` for automatic source cleanup.

## Interactive source layout

- `src/strategy/` contains the typed multi-leg strategy engine, chart and view.
- `src/payoff-explorer/` gives each product family its own panel module.
- `src/option-lab/` separates option math, simulations, workers and rendering.
- `src/structured/` shares one lifecycle engine and controller across reverse-convertible, coupon-memory and lock-in pages.
- `src/basket/`, `src/participation/` and `src/koda-kodd/` keep each product engine independent from its page controller and worker.
- `src/specification/` and `src/decoder/` separate contract rules and case data from presentation.
- `src/legacy/` contains the older standalone labs, now split into strict TypeScript calculation engines and JavaScript presentation modules without browser globals.
- `src/shared/` contains deterministic simulation primitives used across product engines.

Add an interactive page to `bundledEntries` in `vite.config.ts`. Keep financial rules in a strict TypeScript engine module where they can be tested without a browser, and keep DOM rendering in the page entry module. Presentation-only JavaScript remains appropriate where TypeScript would add assertions without improving the underlying design.

## Important note

This material is educational. The simulations use simplified illustrative models and are not pricing tools, investment advice, or a substitute for reviewing final legal terms.

The project is institution-neutral: examples are drawn from public market conventions or are explicitly fictional, and no private or organisation-specific material belongs in the repository.
