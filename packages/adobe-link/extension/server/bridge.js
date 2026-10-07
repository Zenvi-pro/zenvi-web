"use strict";

/**
 * The CEP calls Zenvi Link needs, over `window.__adobe_cep__` (the object
 * Adobe's CSInterface.js wraps; CSInterface itself is not vendored).
 */

/** `file:///Users/me/x` / `file:///C:/x` (as getSystemPath returns them) -> a file system path. */
function fileUriToPath(uri) {
  let value = decodeURI(String(uri));
  if (value.indexOf("file://") === 0) {
    value = value.slice("file://".length);
    if (/^\/[A-Za-z]:/.test(value)) value = value.slice(1);
  }
  return value;
}

function createCepBridge(cep) {
  if (!cep) throw new Error("Zenvi Link runs inside an Adobe CEP extension (window.__adobe_cep__ is missing)");
  const bridge = {
    /** Run ExtendScript; resolves with the result string ("EvalScript error." when it threw). */
    evalScript(script) {
      return new Promise((resolve) => {
        cep.evalScript(script, (result) => resolve(result === undefined || result === null ? "" : String(result)));
      });
    },
    /** {appName: "AEFT" | "PPRO", appVersion, appId, appSkinInfo, ...}; read fresh (the skin changes). */
    hostEnvironment() {
      return JSON.parse(cep.getHostEnvironment());
    },
    /** "extension", "userData", "hostApplication", ... as a file system path. */
    systemPath(kind) {
      return fileUriToPath(cep.getSystemPath(kind));
    },
    addEventListener(type, handler) {
      cep.addEventListener(type, handler);
    },
    removeEventListener(type, handler) {
      cep.removeEventListener(type, handler);
    },
    /** Broadcast a CSXS event to the other Zenvi Link extension in this app. */
    dispatchEvent(type, data) {
      cep.dispatchEvent({
        type: type,
        scope: "APPLICATION",
        appId: bridge.hostEnvironment().appId,
        extensionId: cep.getExtensionId(),
        data: typeof data === "string" ? data : JSON.stringify(data),
      });
    },
    extensionId() {
      return cep.getExtensionId();
    },
  };
  return bridge;
}

module.exports = { createCepBridge, fileUriToPath };
