export type BarrierDirection = "down" | "up";
export type BarrierSwitch = "in" | "out";
export type VanillaType = "call" | "put";
export type PathId = "inside" | "down-touch" | "up-touch";

export interface BarrierScenario {
  direction: BarrierDirection;
  barrierSwitch: BarrierSwitch;
  vanillaType: VanillaType;
  pathId: PathId;
}

export interface PathPreset {
  id: PathId;
  label: string;
  shortLabel: string;
  prices: number[];
}

export interface BarrierResult {
  name: string;
  barrier: number;
  touched: boolean;
  touchIndex: number | null;
  startsActive: boolean;
  activeAtMaturity: boolean;
  finalPrice: number;
  vanillaPayoff: number;
  barrierPayoff: number;
  pairedPayoff: number;
}

export const STRIKE = 100;

export const pathPresets: Record<PathId, PathPreset> = {
  inside: {
    id: "inside",
    label: "The path stays between both barriers and finishes at 110.",
    shortLabel: "No touch",
    prices: [100, 103, 99, 105, 102, 108, 106, 112, 110],
  },
  "down-touch": {
    id: "down-touch",
    label: "The path touches the lower barrier, recovers, and finishes at 90.",
    shortLabel: "Touch down",
    prices: [100, 96, 91, 85, 78, 84, 94, 98, 90],
  },
  "up-touch": {
    id: "up-touch",
    label: "The path touches the upper barrier, falls back, and finishes at 110.",
    shortLabel: "Touch up",
    prices: [100, 105, 111, 116, 122, 118, 114, 108, 110],
  },
};

export function barrierFor(direction: BarrierDirection): number {
  return direction === "down" ? 80 : 120;
}

function firstTouch(prices: number[], direction: BarrierDirection, barrier: number): number | null {
  const index = prices.findIndex((price) =>
    direction === "down" ? price <= barrier : price >= barrier,
  );
  return index < 0 ? null : index;
}

export function evaluateBarrierScenario(scenario: BarrierScenario): BarrierResult {
  const path = pathPresets[scenario.pathId];
  const barrier = barrierFor(scenario.direction);
  const touchIndex = firstTouch(path.prices, scenario.direction, barrier);
  const touched = touchIndex !== null;
  const startsActive = scenario.barrierSwitch === "out";
  const activeAtMaturity = scenario.barrierSwitch === "in" ? touched : !touched;
  const finalPrice = path.prices.at(-1) ?? STRIKE;
  const vanillaPayoff =
    scenario.vanillaType === "call"
      ? Math.max(finalPrice - STRIKE, 0)
      : Math.max(STRIKE - finalPrice, 0);
  const barrierPayoff = activeAtMaturity ? vanillaPayoff : 0;
  const pairedPayoff = activeAtMaturity ? 0 : vanillaPayoff;
  const directionLabel = scenario.direction === "down" ? "Down" : "Up";
  const switchLabel = scenario.barrierSwitch === "in" ? "in" : "out";

  return {
    name: `${directionLabel}-and-${switchLabel} ${scenario.vanillaType}`,
    barrier,
    touched,
    touchIndex,
    startsActive,
    activeAtMaturity,
    finalPrice,
    vanillaPayoff,
    barrierPayoff,
    pairedPayoff,
  };
}
