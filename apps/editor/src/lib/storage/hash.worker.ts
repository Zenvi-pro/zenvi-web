// Hashes a File off the main thread. Messages: { id, file } → { id, progress } … { id, sha256 } | { id, error }.
import { sha256Blob } from "./sha256";

interface HashRequest {
  id: number;
  file: Blob;
}

/** The part of DedicatedWorkerGlobalScope this worker uses (the app compiles with the DOM lib). */
interface WorkerScope {
  onmessage: ((event: MessageEvent<HashRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, file } = event.data;
  let lastPost = 0;
  sha256Blob(file, (done, total) => {
    const now = performance.now();
    if (now - lastPost > 100 || done === total) {
      lastPost = now;
      scope.postMessage({ id, progress: total ? done / total : 1 });
    }
  })
    .then((sha256) => scope.postMessage({ id, sha256 }))
    .catch((error: unknown) => scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }));
};
