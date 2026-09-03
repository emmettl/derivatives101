/**
 * Predict-then-reveal prompts for the labs.
 *
 * A prompt names one control change and one readout on the page. The learner
 * commits to a prediction, the prompt applies the change to the live lab,
 * waits for the page to settle, and grades the prediction against what the
 * engine actually produced. The correct answer is therefore computed from the
 * page's own numbers rather than stored, so it stays right when models change.
 */

export interface PredictChoice {
  id: string;
  label: string;
}

export interface PredictPrompt {
  /** Stable id, used to remember the outcome in the browser. */
  id: string;
  question: string;
  /**
   * What the learner is asked to predict, shown with the current value. When
   * `match` is given, the selector names a container of stat cards and the
   * value is read from the card whose label matches.
   */
  readout: {
    selector: string;
    label: string;
    match?: string | RegExp;
    parse?: (text: string) => number | undefined;
  };
  /** The control the prompt will move, and the value it will set. */
  change: { selector: string; value: string; describe: string };
  choices: PredictChoice[];
  /** Returns the id of the choice the actual numbers support. */
  judge: (before: number, after: number) => string;
  /** Feedback shown after the reveal. */
  explain: (before: number, after: number) => string;
  /** Optional status element that reads "current" once the page has settled. */
  settle?: string;
}

export interface PredictOptions {
  heading?: string;
  storageKey?: string;
}

const NUMBER = /-?\d+(?:[.,]\d+)?/;

export function parseFirstNumber(text: string): number | undefined {
  const match = NUMBER.exec(text.replace(/−/g, "-"));
  if (!match) return undefined;
  const value = Number(match[0].replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

export function findReadout(readout: PredictPrompt["readout"]): HTMLElement | null {
  const root = document.querySelector<HTMLElement>(readout.selector);
  if (!root || readout.match === undefined) return root;
  const matcher =
    typeof readout.match === "string"
      ? (text: string) => text.trim().toLowerCase() === readout.match?.toString().toLowerCase()
      : (text: string) => (readout.match as RegExp).test(text.trim());
  for (const label of root.querySelectorAll<HTMLElement>("span, th, dt, .stat-label")) {
    if (!matcher(label.textContent ?? "")) continue;
    const value = label.parentElement?.querySelector<HTMLElement>("strong, td, dd, output");
    if (value) return value;
  }
  return null;
}

function readValue(prompt: PredictPrompt): { text: string; value: number | undefined } {
  const element = findReadout(prompt.readout);
  const text = element?.textContent?.trim() ?? "";
  const parse = prompt.readout.parse ?? parseFirstNumber;
  return { text, value: parse(text) };
}

function applyChange(prompt: PredictPrompt): string | undefined {
  const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(
    prompt.change.selector,
  );
  if (!control) return undefined;
  const previous = control.value;
  control.value = prompt.change.value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
  return previous;
}

function restoreControl(prompt: PredictPrompt, previous: string): void {
  const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(
    prompt.change.selector,
  );
  if (!control) return;
  control.value = previous;
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Wait for the page to finish reacting: status back to "current", readout stable. */
async function settle(prompt: PredictPrompt, before: string): Promise<void> {
  const started = performance.now();
  const timeout = 12_000;
  await wait(250);
  if (prompt.settle) {
    while (performance.now() - started < timeout) {
      const status = document.querySelector(prompt.settle)?.textContent ?? "";
      if (/current/i.test(status)) break;
      await wait(120);
    }
  }
  let last = readValue(prompt).text;
  let stableFor = 0;
  while (performance.now() - started < timeout) {
    await wait(150);
    const current = readValue(prompt).text;
    if (current === last && (current !== before || stableFor >= 4)) {
      stableFor += 1;
      if (stableFor >= 2) return;
    } else {
      stableFor = current === last ? stableFor + 1 : 0;
      last = current;
    }
  }
}

function storageKeyFor(options: PredictOptions, prompt: PredictPrompt): string {
  return `${options.storageKey ?? "derivatives101:predict"}:${location.pathname}:${prompt.id}`;
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable; the prompt still works for this visit.
  }
}

function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountPredictions(
  container: HTMLElement,
  prompts: PredictPrompt[],
  options: PredictOptions = {},
): void {
  if (!prompts.length) return;
  container.classList.add("predict");
  container.replaceChildren();
  const eyebrow = element("p", "predict-eyebrow", "Predict before you move it");
  const heading = element("h2", "predict-heading", options.heading ?? "Commit to a prediction");
  const stage = element("div", "predict-stage");
  const nav = element("div", "predict-nav");
  container.append(eyebrow, heading, stage, nav);

  let index = 0;

  const show = (): void => {
    const prompt = prompts[index];
    stage.replaceChildren();
    nav.replaceChildren();
    const key = storageKeyFor(options, prompt);
    const remembered = recall(key);

    const current = readValue(prompt);
    const question = element("h3", "predict-question", prompt.question);
    const now = element("p", "predict-now");
    now.append(
      element("span", undefined, `Right now: ${prompt.readout.label} `),
      element("strong", undefined, current.text || "—"),
    );
    const change = element("p", "predict-change", prompt.change.describe);
    const choices = element("div", "predict-choices");
    choices.setAttribute("role", "group");
    choices.setAttribute("aria-label", "Your prediction");
    const feedback = element("p", "predict-feedback");
    feedback.setAttribute("aria-live", "polite");
    const actions = element("div", "predict-actions");
    const reveal = element("button", "predict-reveal", "Apply and reveal") as HTMLButtonElement;
    reveal.type = "button";
    reveal.disabled = true;
    const restore = element("button", "predict-restore", "Put it back") as HTMLButtonElement;
    restore.type = "button";
    restore.hidden = true;
    actions.append(reveal, restore);

    let chosen: string | undefined;
    const buttons = prompt.choices.map((choice) => {
      const button = element("button", undefined, choice.label) as HTMLButtonElement;
      button.type = "button";
      button.dataset.choice = choice.id;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        if (reveal.dataset.done) return;
        chosen = choice.id;
        buttons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
        reveal.disabled = false;
        feedback.textContent = "";
      });
      choices.append(button);
      return button;
    });

    const nowValue = now.querySelector("strong");
    const refresh = window.setInterval(() => {
      if (!nowValue || !stage.contains(now) || reveal.dataset.done) {
        window.clearInterval(refresh);
        return;
      }
      nowValue.textContent = readValue(prompt).text || "—";
    }, 500);

    let previous: string | undefined;
    reveal.addEventListener("click", async () => {
      if (!chosen || reveal.dataset.done) return;
      reveal.disabled = true;
      reveal.textContent = "Applying…";
      buttons.forEach((item) => (item.disabled = true));
      const before = readValue(prompt);
      previous = applyChange(prompt);
      await settle(prompt, before.text);
      const after = readValue(prompt);
      reveal.dataset.done = "true";
      reveal.textContent = "Revealed";
      if (before.value === undefined || after.value === undefined) {
        feedback.textContent = `It went from ${before.text || "—"} to ${after.text || "—"}.`;
        restore.hidden = previous === undefined;
        return;
      }
      const correct = prompt.judge(before.value, after.value);
      buttons.forEach((item) => {
        const id = item.dataset.choice;
        item.classList.toggle("correct", id === correct);
        item.classList.toggle("incorrect", id === chosen && chosen !== correct);
      });
      const verdict = chosen === correct ? "Right." : "Not this time.";
      const label = prompt.readout.label.charAt(0).toUpperCase() + prompt.readout.label.slice(1);
      feedback.textContent = `${verdict} ${label} went from ${before.text} to ${after.text}. ${prompt.explain(before.value, after.value)}`;
      remember(key, chosen === correct ? "right" : "wrong");
      restore.hidden = previous === undefined;
    });

    restore.addEventListener("click", () => {
      if (previous !== undefined) restoreControl(prompt, previous);
      restore.hidden = true;
    });

    stage.append(question, now, change, choices, actions, feedback);
    if (remembered) {
      const note = element(
        "p",
        "predict-remembered",
        remembered === "right"
          ? "You predicted this one correctly on an earlier visit."
          : "You tried this one before. See if the outcome matches your memory.",
      );
      stage.append(note);
    }

    if (prompts.length > 1) {
      const counter = element("span", "predict-counter", `${index + 1} of ${prompts.length}`);
      const previousButton = element("button", "predict-step", "Previous") as HTMLButtonElement;
      previousButton.type = "button";
      previousButton.disabled = index === 0;
      previousButton.addEventListener("click", () => {
        index = Math.max(0, index - 1);
        show();
      });
      const nextButton = element("button", "predict-step", "Next prediction") as HTMLButtonElement;
      nextButton.type = "button";
      nextButton.disabled = index >= prompts.length - 1;
      nextButton.addEventListener("click", () => {
        index = Math.min(prompts.length - 1, index + 1);
        show();
      });
      nav.append(previousButton, counter, nextButton);
    }
  };

  show();
}

/** Helpers for common judgements, expressed on the readout's own scale. */
export const judges = {
  /** Classify a change as up, down or about the same, with a tolerance on the readout's scale. */
  direction(tolerance: number) {
    return (before: number, after: number): string =>
      after - before > tolerance ? "up" : before - after > tolerance ? "down" : "same";
  },
  /** Classify the size of a rise: "big" beyond a ratio, "small" for any other rise, else "down". */
  riseSize(ratio: number) {
    return (before: number, after: number): string => {
      if (after <= before) return "down";
      return after >= before * ratio ? "big" : "small";
    };
  },
};
