import { mountPredictions } from "./predict";
import { promptsForPage } from "./predict-prompts";

const container = document.getElementById("predict");
if (container) mountPredictions(container, promptsForPage(location.pathname));
