"use strict";

// Runs in the invisible service extension's page (CEP mixed context, so
// Node's require is available) and starts the Zenvi Link server for this app.
(function () {
  var cep = window.__adobe_cep__;
  // getSystemPath returns a file:// URI (file:///C:/... on Windows); same rule
  // as bridge.fileUriToPath, inlined because nothing can be required yet.
  var uri = decodeURI(cep.getSystemPath("extension")).replace(/^file:\/\//, "");
  var extensionDir = /^\/[A-Za-z]:/.test(uri) ? uri.slice(1) : uri;
  require(require("path").join(extensionDir, "server", "index.js"))
    .boot({ cep: cep, window: window, mode: "service", extensionDir: extensionDir })
    .catch(function (error) {
      console.error("[Zenvi Link] the service did not start: " + (error && error.stack ? error.stack : error));
    });
})();
