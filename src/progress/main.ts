import { COURSE_LESSONS, continueTarget, readProgress } from "../shared/progress";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing progress element #${id}`);
  return node as T;
}

function renderProgress(): void {
  const progress = readProgress();
  const completed = progress.completedLessonIds.size;
  const resume = continueTarget(progress);
  const resumeLink = element<HTMLAnchorElement>("resume-link");
  resumeLink.href = resume.href;
  resumeLink.textContent = resume.label;

  const panel = element<HTMLElement>("learner-progress");
  panel.hidden = !progress.hasActivity;
  element("progress-lessons").textContent = `${completed} of ${COURSE_LESSONS.length}`;
  element("progress-bar").style.width = `${(completed / COURSE_LESSONS.length) * 100}%`;
  element("progress-track").setAttribute("aria-valuenow", String(completed));
  element("progress-quizzes").textContent = String(progress.correctQuizCount);
  element("progress-predictions").textContent = String(progress.predictionAttemptCount);
  element("progress-next").textContent = resume.label;

  document.querySelectorAll<HTMLElement>("[data-lesson-id]").forEach((card) => {
    const lessonId = card.dataset.lessonId;
    const isComplete = lessonId !== undefined && progress.completedLessonIds.has(lessonId);
    card.classList.toggle("completed", isComplete);
    let status = card.querySelector<HTMLElement>(".lesson-status");
    if (isComplete && !status) {
      status = document.createElement("span");
      status.className = "lesson-status";
      card.prepend(status);
    }
    if (status) {
      status.hidden = !isComplete;
      status.textContent = "Completed";
    }
  });
}

renderProgress();
window.addEventListener("storage", renderProgress);
window.addEventListener("derivatives101:progress", renderProgress);
