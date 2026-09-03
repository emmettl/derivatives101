import { judges, type PredictPrompt } from "./predict";

const pp = (value: number) => `${Math.abs(value).toFixed(1)} percentage points`;

const upSameDown = [
  { id: "up", label: "It goes up" },
  { id: "same", label: "It stays about the same" },
  { id: "down", label: "It goes down" },
];

const riseSizes = (what: string) => [
  { id: "big", label: `${what} rises by half or more` },
  { id: "small", label: `${what} rises, but by less than half` },
  { id: "down", label: `${what} falls` },
];

const structuredStatus = "#simulation-status";

const prompts: Record<string, PredictPrompt[]> = {
  "reverse-convertible-lab": [
    {
      id: "barrier-up",
      question:
        "You raise the knock-in barrier from 65% to 80% and change nothing else. What happens to the share of paths on which the barrier condition occurs?",
      readout: { selector: "#stats", match: "Barrier condition", label: "barrier condition on" },
      change: {
        selector: "#control-barrier",
        value: "80",
        describe: "The lab will move the barrier slider to 80%.",
      },
      choices: upSameDown,
      judge: judges.direction(1),
      explain: (before, after) =>
        `Every path that reached 65 also passed 80 on the way, and paths that stopped between the two are added. A higher barrier can only add breaches, here ${pp(after - before)} of them.`,
      settle: structuredStatus,
    },
    {
      id: "vol-up",
      question:
        "You double volatility from 30% to 60% with the same 8% coupon. What happens to the share of paths that lose money?",
      readout: { selector: "#stats", match: "Lost money", label: "paths losing money" },
      change: {
        selector: "#control-vol",
        value: "60",
        describe: "The lab will move the volatility slider to 60%.",
      },
      choices: upSameDown,
      judge: judges.direction(1),
      explain: () =>
        "More volatility means more paths cross the barrier and finish low. In a real issue the coupon would rise to pay for that; here the coupon is fixed, so the investor simply loses more often.",
      settle: structuredStatus,
    },
  ],
  "coupon-memory-lab": [
    {
      id: "coupon-level-down",
      question:
        "You lower the coupon condition from 75% to 60% of the initial level. What happens to the average number of missed observations?",
      readout: { selector: "#stats", match: "Missed observations", label: "missed observations" },
      change: {
        selector: "#control-couponLevel",
        value: "60",
        describe: "The lab will move the coupon level slider to 60%.",
      },
      choices: upSameDown,
      judge: judges.direction(0.1),
      explain: () =>
        "A lower coupon condition is easier to satisfy on every observation date, so fewer coupons are missed and memory has less to recover.",
      settle: structuredStatus,
    },
    {
      id: "call-level-up",
      question:
        "You raise the autocall level from 100% to 115%. What happens to the share of notes that autocall?",
      readout: { selector: "#stats", match: "Autocalled", label: "autocalled" },
      change: {
        selector: "#control-callLevel",
        value: "115",
        describe: "The lab will move the autocall level slider to 115%.",
      },
      choices: upSameDown,
      judge: judges.direction(1),
      explain: () =>
        "The underlying must now be 15% higher on an observation date, so fewer paths qualify and the note lives longer, collecting more coupons but staying exposed to the barrier.",
      settle: structuredStatus,
    },
  ],
  "lock-in-lab": [
    {
      id: "lock-level-up",
      question:
        "You raise the lock-in level from 110% to 130%. What happens to the share of paths that ever lock in?",
      readout: { selector: "#stats", match: "Any lock-in", label: "paths with a lock-in" },
      change: {
        selector: "#control-lockLevel",
        value: "130",
        describe: "The lab will move the lock-in level slider to 130%.",
      },
      choices: upSameDown,
      judge: judges.direction(1),
      explain: () =>
        "A higher lock level is reached by fewer paths, so the feature triggers less often. The floor it sets is higher, but only for the paths that get there.",
      settle: structuredStatus,
    },
    {
      id: "vol-up",
      question:
        "You raise volatility from 30% to 50%. Wider paths reach the lock level more often, but they also breach the barrier more often. What happens to the share of paths that lose money?",
      readout: { selector: "#stats", match: "Lost money", label: "paths losing money" },
      change: {
        selector: "#control-vol",
        value: "50",
        describe: "The lab will move the volatility slider to 50%.",
      },
      choices: upSameDown,
      judge: judges.direction(1),
      explain: () =>
        "Both effects are real, but the lock-in only helps paths that were already going up, while the barrier catches paths going down. Extra volatility feeds the second group more than the first.",
      settle: structuredStatus,
    },
  ],
  "basket-lab": [
    {
      id: "correlation-down",
      question:
        "You cut pairwise correlation from 45% to 0%. What happens to the share of worst-of notes that lose money?",
      readout: { selector: "#basket-stats", match: "Lost money", label: "notes losing money" },
      change: {
        selector: "#basket-correlation",
        value: "0",
        describe: "The lab will move the correlation slider to 0%.",
      },
      choices: upSameDown,
      judge: judges.direction(1),
      explain: () =>
        "Lower correlation means the three names spread out more, and a worst-of note always follows the weakest one. Dispersion is the risk this product sells.",
      settle: "#basket-simulation-status",
    },
    {
      id: "correlation-up",
      question:
        "You raise pairwise correlation from 45% to 95%. What happens to the share of notes that autocall?",
      readout: { selector: "#basket-stats", match: "Autocalled", label: "autocalled" },
      change: {
        selector: "#basket-correlation",
        value: "95",
        describe: "The lab will move the correlation slider to 95%.",
      },
      choices: upSameDown,
      judge: judges.direction(1),
      explain: () =>
        "When the names move together, the worst of them is rarely far below the others, so the worst-of test behaves almost like a single-underlying test and clears the call level more often.",
      settle: "#basket-simulation-status",
    },
  ],
  "koda-kodd-lab": [
    {
      id: "gearing-knockout",
      question:
        "You double the gearing from 2× to 4×. What happens to the share of contracts that knock out?",
      readout: { selector: "#koda-stats", match: "Knocked out", label: "knocked out" },
      change: {
        selector: "#koda-gearing",
        value: "4",
        describe: "The lab will move the gearing slider to 4×.",
      },
      choices: upSameDown,
      judge: judges.direction(0.5),
      explain: () =>
        "Gearing changes how many units the client must buy below the strike. It does nothing to the path, so the knock-out frequency cannot move. Gearing changes the loss, not the gain.",
      settle: "#koda-simulation-status",
    },
    {
      id: "gearing-units",
      question:
        "Same change, gearing from 2× to 4×. What happens to the average number of units accumulated?",
      readout: { selector: "#koda-stats", match: "Average units", label: "average units" },
      change: {
        selector: "#koda-gearing",
        value: "4",
        describe: "The lab will move the gearing slider to 4×.",
      },
      choices: riseSizes("Average units"),
      judge: judges.riseSize(1.5),
      explain: () =>
        "Only the fixings below the strike are geared, so units rise by less than the gearing ratio unless the path spends most of its life below the strike.",
      settle: "#koda-simulation-status",
    },
  ],
  "participation-lab": [
    {
      id: "vol-up",
      question:
        "You raise volatility from 25% to 45%. What happens to the share of paths on which the bonus barrier is breached?",
      readout: {
        selector: "#participation-stats",
        match: "Barrier breached",
        label: "barrier breached",
      },
      change: {
        selector: "#participation-vol",
        value: "45",
        describe: "The lab will move the volatility slider to 45%.",
      },
      choices: riseSizes("Breaches"),
      judge: judges.riseSize(1.5),
      explain: () =>
        "A daily-monitored barrier is a bet on the path, not the endpoint. Wider paths touch it far more often, which is why the bonus is cheap on calm names and expensive on volatile ones.",
      settle: "#participation-simulation-status",
    },
  ],
  "product-solver": [
    {
      id: "barrier-up",
      question:
        "You raise the knock-in barrier from 60% to 75% on the autocall. What happens to the offered coupon?",
      readout: { selector: "#headline-value", label: "offered coupon" },
      change: {
        selector: "#barrier",
        value: "75",
        describe: "The lab will move the barrier slider to 75%.",
      },
      choices: upSameDown,
      judge: judges.direction(0.05),
      explain: () =>
        "The investor is short a down-and-in put. A higher barrier makes that put more valuable, and the extra premium is paid out as coupon.",
    },
    {
      id: "spread-up",
      question:
        "The issuer's funding spread widens from 1.0% to 2.5%. What happens to the coupon this issuer can offer?",
      readout: { selector: "#headline-value", label: "offered coupon" },
      change: {
        selector: "#spread",
        value: "2.5",
        describe: "The lab will move the funding spread slider to 2.5%.",
      },
      choices: upSameDown,
      judge: judges.direction(0.05),
      explain: () =>
        "A weaker issuer discounts its own bond more heavily, so the bond leg costs less and more of the investor's 100 is left for coupon. A higher coupon can be a credit signal, not a gift.",
    },
  ],
  "option-lab": [
    {
      id: "vol-doubles",
      question:
        "You double volatility from 25% to 50% on the at-the-money one-year call. What happens to its price?",
      readout: { selector: "#price", label: "call price" },
      change: {
        selector: "#vol",
        value: "50",
        describe: "The lab will move the volatility slider to 50%.",
      },
      choices: riseSizes("The price"),
      judge: judges.riseSize(1.5),
      explain: () =>
        "At the money, option value is close to proportional to volatility, so doubling volatility roughly doubles the price. Away from the money the relationship bends.",
    },
    {
      id: "rate-up",
      question: "You raise the interest rate from 3% to 10%. What happens to the call price?",
      readout: { selector: "#price", label: "call price" },
      change: {
        selector: "#rate",
        value: "10",
        describe: "The lab will move the rate slider to 10%.",
      },
      choices: upSameDown,
      judge: judges.direction(0.05),
      explain: () =>
        "A call defers paying the strike. Higher rates make that deferral worth more, so calls gain value and puts lose it.",
    },
  ],
  "forward-carry": [
    {
      id: "dividend-up",
      question:
        "You raise the dividend yield from 1% to 6% while the rate stays at 5%. What happens to the forward level?",
      readout: { selector: "#forward-stats", match: "Forward level", label: "forward level" },
      change: {
        selector: "#forward-dividendYield",
        value: "0.06",
        describe: "The lab will move the dividend yield slider to 6%.",
      },
      choices: [
        { id: "up", label: "It rises further above spot" },
        { id: "same", label: "It stays about where it is" },
        { id: "down", label: "It falls, possibly below spot" },
      ],
      judge: judges.direction(0.2),
      explain: () =>
        "Carry is the rate you pay minus the dividends you collect. Once dividends exceed the rate, holding the asset earns more than it costs and the forward sits below spot.",
    },
  ],
  "options-a-la-carte": [
    {
      id: "vol-up-butterfly",
      question:
        "You double volatility from 25% to 50% under the default butterfly. What happens to the probability of profit at expiry?",
      readout: {
        selector: "#strategy-simulation-stats",
        match: "Probability of profit",
        label: "probability of profit",
      },
      change: {
        selector: "#strategy-volatility",
        value: "0.5",
        describe: "The lab will move the volatility slider to 50%.",
      },
      choices: upSameDown,
      judge: judges.direction(1),
      explain: () =>
        "A butterfly pays when the underlying finishes near the middle strike. Doubling volatility spreads the terminal distribution out, so fewer paths land in the profitable zone.",
      settle: "#strategy-simulation-status",
    },
  ],
  "credit-liquidity": [
    {
      id: "spread-widens",
      question:
        "The issuer's credit spread widens from 1.5% to 6%. What happens to the issuer-adjusted value of the note?",
      readout: {
        selector: "#credit-stats",
        match: "Issuer-adjusted value",
        label: "issuer-adjusted value",
      },
      change: {
        selector: "#credit-spread",
        value: "0.06",
        describe: "The lab will move the spread slider to 6%.",
      },
      choices: upSameDown,
      judge: judges.direction(0.1),
      explain: () =>
        "The promise has not changed, but the market now discounts this issuer's promises more heavily. The note falls even though the underlying has not moved.",
    },
  ],
  "currency-risk": [
    {
      id: "fx-falls",
      question:
        "The foreign currency falls 20% against the home currency while the equity still ends up 25%. What happens to the home-currency return of the direct holding?",
      readout: {
        selector: "#currency-stats",
        match: "Home-currency return",
        label: "home-currency return",
      },
      change: {
        selector: "#currency-fxTerminal",
        value: "80",
        describe: "The lab will move the terminal FX slider to 80.",
      },
      choices: upSameDown,
      judge: judges.direction(0.5),
      explain: () =>
        "An unhedged holding earns the equity return times the currency return. A 20% currency fall takes most of a 25% equity gain away, which is what a quanto structure is sold to prevent.",
    },
  ],
};

export function promptsForPage(pathname: string): PredictPrompt[] {
  const name =
    pathname
      .split("/")
      .pop()
      ?.replace(/\.html$/, "") ?? "";
  return prompts[name] ?? [];
}
