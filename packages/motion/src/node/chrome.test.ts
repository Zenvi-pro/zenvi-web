import { describe, expect, it } from "vitest";
import { CHROME_ARGS, chromeArgs } from "./chrome.js";

describe("chromeArgs", () => {
  it("keeps Chrome's sandbox unless told to drop it", () => {
    expect(chromeArgs({})).toEqual(CHROME_ARGS);
    expect(chromeArgs({ ZENVI_CHROME_NO_SANDBOX: "0" })).not.toContain("--no-sandbox");
    expect(chromeArgs({ ZENVI_CHROME_NO_SANDBOX: "1" })).toEqual([...CHROME_ARGS, "--no-sandbox"]);
  });
});
