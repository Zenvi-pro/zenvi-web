"use strict";

/**
 * Tool calls run one at a time, first in first out: ExtendScript is
 * single-threaded, and evalScript calls queue inside the app anyway.
 *
 * A call's timeout counts from when it was queued, so the server answers
 * every call within its timeout:
 *  - still waiting when it expires: dropped, never runs ("expired");
 *  - running when it expires: reported as "timeout", but the queue stays
 *    blocked until ExtendScript really returns (the next call could not
 *    start inside the app before that).
 * While the running call has been going for longer than `busyAfterMs`
 * (default 10 min: a hung dialog, a long render), new calls are turned away
 * at once ("busy") instead of piling up behind it.
 */
class CallQueue {
  constructor(options) {
    const opts = options || {};
    this.busyAfterMs = opts.busyAfterMs !== undefined ? opts.busyAfterMs : 10 * 60 * 1000;
    this.now = opts.now || Date.now;
    this.waiting = [];
    this.running = null;
  }

  /** True when nothing runs or waits. */
  get idle() {
    return this.running === null && this.waiting.length === 0;
  }

  /** {label, ms} of the running call, or null. */
  current() {
    return this.running ? { label: this.running.label, ms: this.now() - this.running.startedAt } : null;
  }

  /**
   * Queue `execute` (a function returning a promise). Resolves (never
   * rejects) with {kind, ms} where kind is "done" (+ value), "error"
   * (+ error), "timeout", "busy" (+ running) or "expired" (+ running).
   */
  run(label, timeoutMs, execute) {
    const running = this.current();
    if (running && running.ms > this.busyAfterMs) {
      return Promise.resolve({ kind: "busy", running: running, ms: 0 });
    }
    return new Promise((resolve) => {
      const job = { label: label, timeoutMs: timeoutMs, execute: execute, resolve: resolve, settled: false, queuedAt: this.now() };
      job.waitTimer = setTimeout(() => {
        const index = this.waiting.indexOf(job);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        this.settle(job, { kind: "expired", running: this.current(), ms: this.now() - job.queuedAt });
      }, timeoutMs);
      this.waiting.push(job);
      this.pump();
    });
  }

  settle(job, outcome) {
    if (job.settled) return;
    job.settled = true;
    job.resolve(outcome);
  }

  pump() {
    if (this.running || this.waiting.length === 0) return;
    const job = this.waiting.shift();
    clearTimeout(job.waitTimer);
    const startedAt = this.now();
    this.running = { label: job.label, startedAt: startedAt };
    const finish = (outcome) => {
      clearTimeout(runTimer);
      this.running = null;
      outcome.ms = this.now() - startedAt;
      this.settle(job, outcome);
      this.pump();
    };
    const runTimer = setTimeout(() => {
      this.settle(job, { kind: "timeout", ms: this.now() - startedAt });
    }, Math.max(0, job.timeoutMs - (startedAt - job.queuedAt)));
    let promise;
    try {
      promise = Promise.resolve(job.execute());
    } catch (error) {
      promise = Promise.reject(error);
    }
    promise.then(
      (value) => finish({ kind: "done", value: value }),
      (error) => finish({ kind: "error", error: error }),
    );
  }
}

module.exports = { CallQueue };
