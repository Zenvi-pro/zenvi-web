import { afterEach, describe, expect, it, vi } from "vitest";
import type { Browser } from "puppeteer-core";
import { ChromeLaunchError, ChromeMissingError, LAUNCH_TIMEOUT_MS, closeChrome, launchChrome, leaseChrome } from "./chrome.js";

// Any existing file passes findChrome; the launcher itself is faked.
const env = { ZENVI_CHROME: process.execPath } as NodeJS.ProcessEnv;

function fakeBrowser(): Browser & { connected: boolean } {
  const browser = {
    connected: true,
    close: vi.fn(async () => {
      browser.connected = false;
    }),
    process: () => null,
  };
  return browser as unknown as Browser & { connected: boolean };
}

const launcher = (...results: (Browser | Error)[]) => {
  const launch = vi.fn(async () => {
    const next = results.shift() ?? fakeBrowser();
    if (next instanceof Error) throw next;
    return next;
  });
  return { launch: launch as never, calls: launch };
};

afterEach(async () => {
  await closeChrome();
});

describe("launchChrome", () => {
  it("waits 90 s per try, and tries once more after a timeout", async () => {
    const browser = fakeBrowser();
    const { launch, calls } = launcher(new Error("Timed out after 30000 ms while waiting for the WS endpoint URL to appear in stdout!"), browser);
    await expect(launchChrome(env, { launch })).resolves.toBe(browser);
    expect(calls).toHaveBeenCalledTimes(2);
    expect(calls.mock.calls[0]![0]).toMatchObject({ timeout: LAUNCH_TIMEOUT_MS, headless: "shell" });
    expect(LAUNCH_TIMEOUT_MS).toBe(90_000);
  });

  it("says what happened and what to do after the second failure", async () => {
    const { launch, calls } = launcher(new Error("Timed out"), new Error("Timed out again"));
    const error = await launchChrome(env, { launch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChromeLaunchError);
    expect((error as Error).message).toMatch(/did not start after 2 tries of 90 s \(Timed out again\).*busy.*zenvi motion setup.*ZENVI_CHROME/);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("takes the timeout from ZENVI_CHROME_TIMEOUT_MS", async () => {
    const { launch, calls } = launcher();
    await launchChrome({ ...env, ZENVI_CHROME_TIMEOUT_MS: "150000" }, { launch });
    expect(calls.mock.calls[0]![0]).toMatchObject({ timeout: 150_000 });
  });

  it("does not try to launch a Chrome that is not there", async () => {
    const { launch, calls } = launcher();
    await expect(launchChrome({ ZENVI_CHROME: "/nonexistent/chrome" } as NodeJS.ProcessEnv, { launch })).rejects.toBeInstanceOf(ChromeMissingError);
    expect(calls).not.toHaveBeenCalled();
  });
});

describe("leaseChrome", () => {
  it("shares one browser between renders, even ones that start together", async () => {
    const { launch, calls } = launcher();
    const [a, b] = await Promise.all([leaseChrome(env, { launch }), leaseChrome(env, { launch })]);
    expect(a.browser).toBe(b.browser);
    a.release();
    b.release();
    const c = await leaseChrome(env, { launch });
    expect(c.browser).toBe(a.browser);
    c.release();
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("replaces a browser that died, and closes on closeChrome", async () => {
    const first = fakeBrowser();
    const second = fakeBrowser();
    const { launch, calls } = launcher(first, second);
    const a = await leaseChrome(env, { launch });
    a.release();
    first.connected = false;
    const b = await leaseChrome(env, { launch });
    expect(b.browser).toBe(second);
    expect(calls).toHaveBeenCalledTimes(2);
    b.release();
    await closeChrome();
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failed launch: the next lease tries again", async () => {
    const { launch, calls } = launcher(new Error("x"), new Error("y"));
    await expect(leaseChrome(env, { launch })).rejects.toBeInstanceOf(ChromeLaunchError);
    const lease = await leaseChrome(env, { launch });
    expect(lease.browser.connected).toBe(true);
    expect(calls).toHaveBeenCalledTimes(3);
    lease.release();
  });
});
