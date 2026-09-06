import { describe, expect, it } from "vitest";

import {
  COURSE_LESSONS,
  continueTarget,
  lessonCompletionKey,
  quizOutcomeKey,
  readProgress,
} from "./progress";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("learner progress", () => {
  it("summarises completed lessons, mastered checks and predictions", () => {
    const storage = new MemoryStorage();
    storage.setItem(lessonCompletionKey("foundations"), "complete");
    storage.setItem(quizOutcomeKey("foundations", 0), "right");
    storage.setItem(quizOutcomeKey("foundations", 1), "right");
    storage.setItem("derivatives101:predict:/option-lab.html:vol-up", "right");
    storage.setItem("derivatives101:predict:/basket-lab.html:correlation-down", "wrong");

    const progress = readProgress(storage);

    expect(progress.completedLessonIds).toEqual(new Set(["foundations"]));
    expect(progress.correctQuizCount).toBe(2);
    expect(progress.predictionAttemptCount).toBe(2);
    expect(progress.predictionCorrectCount).toBe(1);
    expect(progress.hasActivity).toBe(true);
  });

  it("advances a completed lesson to the next unfinished lesson", () => {
    const storage = new MemoryStorage();
    storage.setItem(lessonCompletionKey("foundations"), "complete");
    storage.setItem(
      "derivatives101:progress:last-location",
      JSON.stringify({
        kind: "lesson",
        href: "/lesson-00-foundations.html",
        label: "Foundations",
        lessonId: "foundations",
      }),
    );

    expect(continueTarget(readProgress(storage))).toEqual({
      href: COURSE_LESSONS[1].href,
      label: "Continue with KODA & KODD",
    });
  });

  it("returns to the latest prediction lab", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "derivatives101:progress:last-location",
      JSON.stringify({
        kind: "lab",
        href: "/option-lab.html",
        label: "Option Lab",
      }),
    );

    expect(continueTarget(readProgress(storage))).toEqual({
      href: "/option-lab.html",
      label: "Continue Option Lab",
    });
  });
});
