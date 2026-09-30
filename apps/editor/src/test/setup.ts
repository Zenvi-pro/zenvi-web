// Shared setup for editor tests (jsdom by default; some files opt into node).
import { afterEach } from "vitest";

// React 19 act() support in a non-Jest environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  if (typeof document !== "undefined") document.body.innerHTML = "";
});
