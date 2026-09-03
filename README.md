# Derivatives 101

An independent, generally useful short course in options and structured products.

## Course contents

- Six web-native lessons, from option foundations to protection and leverage, each with an engine-driven chart and comprehension check
- Downloadable PDF lesson decks and a searchable course glossary
- An interactive payoff explorer covering eight product families
- An Option Lab for value surfaces, Greeks and Monte Carlo paths
- Nineteen path-by-path, strategy, design, valuation, solver and specification labs for multi-leg vanilla and barrier options, an inverse solver for strike, implied volatility, spot and barrier, a market solver that prices autocalls, barrier reverse convertibles and protected notes on real indices from a stored snapshot, participation products, accumulators, decumulators, reverse convertibles, step-down autocalls, baskets, conditional coupons, memory, lock-in features, early-exit value, structured-product Greeks, dynamic hedging, volatility skew, forward pricing and carry, cross-currency and quanto payoffs, issuer credit, liquidity, term-sheet analysis and a full requirements capstone
- Flat-volatility and downside-skew path toggles across the six lifecycle labs, with same-seed comparison statistics for barrier, autocall and loss outcomes
- Predict-then-reveal prompts on twelve labs: the learner commits to a prediction, the lab applies the change and grades the prediction against its own live numbers
- Guided teaching scenarios and shareable setups
- Three fictional specimen term sheets for discussion and practice
- A single PDF containing the full lesson series

## Website

The course is published at [emmettl.github.io/derivatives101](https://emmettl.github.io/derivatives101/).

Every push to `main` builds and publishes the multi-page site through GitHub Pages. `index.html` is the course home, the six `lesson-*.html` pages are the primary readings, `glossary.html` is the searchable reference, `payoff-explorer.html` is the quick payoff explorer, and `structured-products.html` is the entry point for the lifecycle labs. The richer interactive pages use Vite module entry points under `src/`.

Run `npm install` once, followed by `npx playwright install chromium` to install the browser used by the interaction tests. Use `npm run dev` for local development and `npm run build` for a type-checked production bundle plus the complete site. `npm run check` verifies Oxfmt formatting, runs Oxlint, checks TypeScript and executes the financial-engine tests. `npm run test:e2e` runs a smoke sweep of every page (load, nudge the first controls, no runtime errors, no NaN, no horizontal overflow at phone width) plus focused checks of chart inspection, Monte Carlo resampling, barrier defaults, lessons and solvers in Chromium; `npm run check:all` runs every check and the production build. Use `npm run format` and `npm run lint:fix` for automatic source cleanup.

## Market snapshot

The Solver Lab can apply a small dated FX snapshot from `market-data/latest.json`. Run `npm run market:snapshot` to refresh it from the ECB Data Portal. The downloader stores the latest EUR/USD, EUR/GBP and EUR/CHF reference rates plus 20- and 60-session annualised realised-volatility calculations; it does not republish the underlying daily history. The Pages workflow refreshes this file on weekday evenings and retains the checked-in last-good snapshot if the source is temporarily unavailable.

The snapshot intentionally supplies only spot and a historical-volatility proxy. Discount and foreign-rate inputs remain explicit user assumptions, and the calculated volatility is not an option-market implied volatility.

## Interactive source layout

- `src/strategy/` contains the typed multi-leg strategy engine, chart and view.
- `src/payoff-explorer/` gives each product family its own panel module.
- `src/option-lab/` separates option math, simulations, workers and rendering.
- `src/structured/` shares one lifecycle engine and controller across reverse-convertible, coupon-memory and lock-in pages.
- `src/basket/`, `src/participation/` and `src/koda-kodd/` keep each product engine independent from its page controller and worker.
- `src/specification/` and `src/decoder/` separate contract rules and case data from presentation.
- `src/market-solver/` prices real-index products from `data/market-snapshot.json`: closed-form protected notes and barrier reverse convertibles, a common-random-number Monte Carlo for autocalls, and a bisection solver for barrier, protection and cap. The snapshot holds continuously compounded zero rates by tenor (decimal), continuous dividend yields, at-the-money implied volatilities by tenor, and a one-year skew slope and curvature per unit of moneyness; its `status` field records that the values are hand-entered approximations until replaced by observed data.
- `src/legacy/` contains the older standalone labs, now split into strict TypeScript calculation engines and JavaScript presentation modules without browser globals.
- `src/shared/` contains deterministic simulation primitives, the shared flat-volatility/downside-skew local-volatility model used across product engines, and the presentation helpers for narrow screens: `collapsible.ts` (with `collapsible.css`) turns input panels and sections into mobile-only accordions, and `chart-size.ts` lets SVG charts switch to a pixel-matched coordinate space so labels stay legible on phones, and the predict-then-reveal module: `predict.ts` renders a prompt card and grades a prediction against the page's own readout after applying a control change, `predict-prompts.ts` holds the per-page prompts keyed by file name, and `predict-mount.ts` is the module script a page includes alongside an empty `#predict` section.

Add an interactive page to `bundledEntries` in `vite.config.ts`. Keep financial rules in a strict TypeScript engine module where they can be tested without a browser, and keep DOM rendering in the page entry module. Presentation-only JavaScript remains appropriate where TypeScript would add assertions without improving the underlying design.

## Important note

This material is educational. The simulations use simplified illustrative models and are not pricing tools, investment advice, or a substitute for reviewing final legal terms.

The project is institution-neutral: examples are drawn from public market conventions or are explicitly fictional, and no private or organisation-specific material belongs in the repository.
