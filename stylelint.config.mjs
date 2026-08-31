/** @type {import("stylelint").Config} */
export default {
  extends: ["stylelint-config-standard", "@stylistic/stylelint-config"],
  rules: {
    "@stylistic/max-line-length": null,
    "@stylistic/declaration-colon-newline-after": null,
    "no-descending-specificity": null,
    "selector-class-pattern": null,
  },
};
