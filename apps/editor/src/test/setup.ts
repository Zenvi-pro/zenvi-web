// Shared setup for editor tests (jsdom by default; some files opt into node).
import { afterEach } from "vitest";

// React 19 act() support in a non-Jest environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  if (typeof document !== "undefined") document.body.innerHTML = "";
});

// jsdom's Blob has no arrayBuffer(); the media pipeline (hashing, fingerprints) reads files with it.
if (typeof Blob !== "undefined" && typeof Blob.prototype.arrayBuffer !== "function" && typeof FileReader !== "undefined") {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
