(function (root) {
  "use strict";

  const presets = {
    upFlat: { id: "upFlat", name: "Equity up · FX flat", equityTerminal: 125, fxTerminal: 100 },
    offset: { id: "offset", name: "Equity up · FX down", equityTerminal: 125, fxTerminal: 80 },
    cushion: { id: "cushion", name: "Equity down · FX up", equityTerminal: 75, fxTerminal: 125 },
    bothDown: { id: "bothDown", name: "Both down", equityTerminal: 75, fxTerminal: 80 }
  };

  function outcomes(config) {
    const equityFactor = config.equityTerminal / 100;
    const fxFactor = config.fxTerminal / 100;
    const localReturn = equityFactor - 1;
    const fxReturn = fxFactor - 1;
    const directHomeValue = 100 * equityFactor * fxFactor;
    const directHomeReturn = directHomeValue / 100 - 1;
    const intrinsicForeign = Math.max(config.equityTerminal - config.strike, 0);
    const quantoOption = config.participation * intrinsicForeign;
    const compoOption = config.participation * intrinsicForeign * fxFactor;
    return {
      equityFactor,
      fxFactor,
      localReturn,
      fxReturn,
      directHomeValue,
      directHomeReturn,
      intrinsicForeign,
      quantoOption,
      compoOption,
      quantoRedemption: 100 + quantoOption,
      compoRedemption: 100 + compoOption
    };
  }

  function grid(config, equityMinimum, equityMaximum, equityCount, fxMinimum, fxMaximum, fxCount) {
    const points = [];
    const xCount = Math.max(2, equityCount || 7);
    const yCount = Math.max(2, fxCount || 5);
    for (let row = 0; row < yCount; row += 1) {
      const fxTerminal = fxMinimum + (fxMaximum - fxMinimum) * row / (yCount - 1);
      for (let column = 0; column < xCount; column += 1) {
        const equityTerminal = equityMinimum + (equityMaximum - equityMinimum) * column / (xCount - 1);
        points.push(Object.assign({ row, column, equityTerminal, fxTerminal }, outcomes(Object.assign({}, config, { equityTerminal, fxTerminal }))));
      }
    }
    return points;
  }

  function payoffCurve(config, minimum, maximum, count) {
    const points = [];
    const total = Math.max(2, count || 81);
    for (let index = 0; index < total; index += 1) {
      const equityTerminal = minimum + (maximum - minimum) * index / (total - 1);
      points.push(Object.assign({ equityTerminal }, outcomes(Object.assign({}, config, { equityTerminal }))));
    }
    return points;
  }

  const api = { presets, outcomes, grid, payoffCurve };
  root.CurrencyEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof self !== "undefined" ? self : globalThis));
