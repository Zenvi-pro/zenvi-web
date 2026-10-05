"use strict";

// The Zenvi Link panel (Window > Extensions > Zenvi Link). Runs in CEP's
// mixed context, so Node's require is available next to the DOM.
(function () {
  var cep = window.__adobe_cep__;
  // Same rule as bridge.fileUriToPath, inlined because nothing can be required yet.
  var uri = decodeURI(cep.getSystemPath("extension")).replace(/^file:\/\//, "");
  var extensionDir = /^\/[A-Za-z]:/.test(uri) ? uri.slice(1) : uri;
  var nodePath = require("path");
  var load = function (file) {
    return require(nodePath.join(extensionDir, file));
  };
  var core = load("panel/panel-core.js");
  var service = load("server/index.js");
  var bridge = load("server/bridge.js").createCepBridge(cep);
  var environment = bridge.hostEnvironment();
  var host = service.hostOf(environment);
  var sendToZenvi = host ? load("panel/send-to-zenvi-" + host + ".js") : null;
  var SERVICE_WAIT_MS = 3000;
  // A service that said it is starting gets this long to become ready before the panel hosts.
  var SERVICE_START_GRACE_MS = 15000;

  var state = { mode: null, url: null, token: null, hosted: null, calls: [], desktop: { running: false }, serviceStarting: false };
  var $ = function (id) {
    return document.getElementById(id);
  };

  function applySkin() {
    var variables = core.skinVariables(bridge.hostEnvironment().appSkinInfo);
    Object.keys(variables).forEach(function (name) {
      document.documentElement.style.setProperty(name, variables[name]);
    });
  }

  function setNotice(text) {
    $("notice").hidden = !text;
    $("notice").textContent = text || "";
  }

  function render() {
    $("app").textContent = host ? service.marketingName(host, String(environment.appVersion)) : environment.appName;
    $("server-state").textContent = state.url ? "Running" : state.mode === "failed" ? "Not running" : "Looking for the Zenvi Link service\u2026";
    $("server-url").textContent = state.url || "\u2014";
    $("server-mode").textContent =
      state.mode === "service" ? "Background service" : state.mode === "panel" ? "This panel (closing it stops the server)" : "\u2014";
    $("desktop-state").textContent = state.desktop.running
      ? "Running (pid " + state.desktop.pid + ")" + (state.desktop.project ? ", " + nodePath.basename(state.desktop.project) : "")
      : "Not running";
    $("copy-config").disabled = !(state.url && state.token);
    var canSend = Boolean(sendToZenvi && typeof sendToZenvi.run === "function" && state.url);
    $("send-to-zenvi").disabled = !canSend;
    $("send-to-zenvi").textContent = (sendToZenvi && sendToZenvi.label) || "Send to Zenvi";
    $("send-to-zenvi").title = canSend ? "" : "Not available yet";
    var list = $("calls");
    list.textContent = "";
    if (state.calls.length === 0) {
      var empty = document.createElement("li");
      empty.className = "muted empty";
      empty.textContent = "No calls yet";
      list.appendChild(empty);
    }
    state.calls.slice(0, 20).forEach(function (call) {
      var item = document.createElement("li");
      item.title = call.summary || "";
      [call.tool, call.status, core.clock(call.at)].forEach(function (text, index) {
        var cell = document.createElement("span");
        cell.textContent = text;
        if (index === 1) cell.className = "status-" + call.status;
        if (index === 2) cell.className = "muted";
        item.appendChild(cell);
      });
      list.appendChild(item);
    });
  }

  function addCall(call) {
    state.calls.unshift(call);
    state.calls.length = Math.min(state.calls.length, 30);
    render();
  }

  function parseEventData(event) {
    try {
      return typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    } catch (_error) {
      return null;
    }
  }

  function readToken(file) {
    try {
      return require("fs").readFileSync(file, "utf8").trim();
    } catch (_error) {
      return null;
    }
  }

  function adoptService(status) {
    if (!status || status.host !== host || status.mode !== "service") return;
    if (status.ready === false || !status.url) {
      // The service is still booting; its ready broadcast follows.
      state.serviceStarting = true;
      return;
    }
    if (state.hosted) {
      // A service came up after this panel started its own server: hand over.
      state.hosted.stop();
      state.hosted = null;
    }
    state.mode = "service";
    state.url = status.url;
    state.token = readToken(status.token_file);
    state.calls = status.recent || state.calls;
    setNotice(status.host_script && !status.host_script.ok ? "Host script problem: " + status.host_script.problem : "");
    render();
  }

  function adoptEndpoint(endpoint) {
    state.mode = "service";
    state.url = endpoint.url;
    state.token = endpoint.token;
    render();
  }

  function hostHere() {
    service
      .boot({ cep: cep, window: window, mode: "panel", extensionDir: extensionDir })
      .then(function (running) {
        state.hosted = running;
        state.mode = "panel";
        state.url = running.server.url;
        state.token = running.server.token;
        running.server.on("call", addCall);
        var problem = running.status().host_script;
        setNotice(
          "No background service answered, so this panel runs the server. Keep the panel open while Zenvi uses " +
            service.marketingName(host, String(environment.appVersion)) + "." + (problem && !problem.ok ? " Host script problem: " + problem.problem : ""),
        );
        render();
      })
      .catch(function (error) {
        if (error && error.code === "SERVICE_RUNNING") {
          // A service won the race; show it instead.
          core.findLiveEndpoint({ host: host }).then(function (endpoint) {
            if (endpoint && !state.url) adoptEndpoint(endpoint);
          });
          return;
        }
        state.mode = "failed";
        setNotice("Zenvi Link could not start: " + error.message);
        render();
      });
  }

  /** No service has answered: look at the discovery file once more, then host here. */
  function fallBack() {
    if (state.url) return;
    core.findLiveEndpoint({ host: host, appVersion: String(environment.appVersion) }).then(function (endpoint) {
      if (state.url) return;
      if (endpoint) adoptEndpoint(endpoint);
      else hostHere();
    });
  }

  function findServer() {
    bridge.addEventListener(service.EVENTS.status, function (event) {
      adoptService(parseEventData(event));
    });
    bridge.addEventListener(service.EVENTS.call, function (event) {
      if (state.mode === "service") {
        var call = parseEventData(event);
        if (call) addCall(call);
      }
    });
    bridge.dispatchEvent(service.EVENTS.statusRequest, { from: "panel" });
    core
      .findLiveEndpoint({ host: host, appVersion: String(environment.appVersion) })
      .then(function (endpoint) {
        if (endpoint && !state.url) adoptEndpoint(endpoint);
      });
    setTimeout(function () {
      if (state.url) return;
      if (state.serviceStarting) setTimeout(fallBack, SERVICE_START_GRACE_MS);
      else fallBack();
    }, SERVICE_WAIT_MS);
  }

  function copyText(text) {
    var area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    var copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (_error) {
      copied = false;
    }
    document.body.removeChild(area);
    if (!copied && navigator.clipboard) navigator.clipboard.writeText(text);
  }

  function showResult(text) {
    $("action-result").hidden = !text;
    $("action-result").textContent = text || "";
  }

  $("copy-config").addEventListener("click", function () {
    var config = core.mcpConfig(host, state.url, state.token);
    copyText(config.claude + "\n\n" + config.json + "\n");
    showResult("Copied a `claude mcp add` line and a JSON config. The token changes when the app restarts.");
  });

  $("send-to-zenvi").addEventListener("click", function () {
    var button = $("send-to-zenvi");
    button.disabled = true;
    showResult("Working\u2026");
    var context = {
      host: host,
      desktop: state.desktop,
      callHostTool: function (name, args) {
        return core.callTool(state.url, state.token, name, args);
      },
      callDesktopTool: function (name, args) {
        var desktop = core.desktopStatus();
        if (!desktop.running || !desktop.url || !desktop.token) return Promise.reject(new Error("The Zenvi desktop app is not running."));
        return core.callTool(desktop.url, desktop.token, name, args);
      },
    };
    Promise.resolve()
      .then(function () {
        return sendToZenvi.run(context);
      })
      .then(function (line) {
        showResult(line || "Sent to Zenvi.");
      })
      .catch(function (error) {
        showResult("Error: " + error.message);
      })
      .then(function () {
        render();
      });
  });

  function refreshDesktop() {
    var desktop = core.desktopStatus();
    state.desktop = { running: desktop.running, pid: desktop.pid, project: desktop.project };
    render();
  }

  applySkin();
  bridge.addEventListener("com.adobe.csxs.events.ThemeColorChanged", applySkin);
  render();
  if (!host) {
    state.mode = "failed";
    setNotice("Zenvi Link supports After Effects and Premiere Pro, not " + environment.appName + ".");
    render();
    return;
  }
  refreshDesktop();
  setInterval(refreshDesktop, 5000);
  findServer();
})();
