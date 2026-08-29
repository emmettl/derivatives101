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

Every push to `main` builds and publishes the multi-page site through GitHub Pages. `index.html` is the course home, `payoff-explorer.html` is the quick payoff explorer, and `structured-products.html` is the entry point for the lifecycle labs. Most labs remain dependency-free browser JavaScript; Vite provides the shared development server and production packaging, while the multi-leg strategy lab is written in TypeScript.

Run `npm install` once, then use `npm run dev` for local development, `npm test` for the strategy-engine checks, and `npm run build` for a type-checked production bundle of the multi-leg lab plus the complete legacy site.

## Important note

This material is educational. The simulations use simplified illustrative models and are not pricing tools, investment advice, or a substitute for reviewing final legal terms.

The project is institution-neutral: examples are drawn from public market conventions or are explicitly fictional, and no private or organisation-specific material belongs in the repository.
