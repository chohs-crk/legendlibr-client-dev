/* ================================
   ENTRY
================================ */
import { startCreateStoryFlow } from "./create-story/create-story-flow.js";

history.replaceState(null, "", "/create-story");
startCreateStoryFlow();
