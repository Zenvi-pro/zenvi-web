// @vitest-environment node
import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Sha256, sha256Blob, toHex } from "./sha256";

const enc = new TextEncoder();

describe("Sha256", () => {
  it("matches the FIPS 180-4 test vectors", () => {
    expect(new Sha256().hex()).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(new Sha256().update(enc.encode("abc")).hex()).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      new Sha256().update(enc.encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).hex(),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("hashes one million 'a' fed in odd-sized chunks", () => {
    const hash = new Sha256();
    const chunk = enc.encode("a".repeat(997));
    let fed = 0;
    while (fed + chunk.length <= 1_000_000) {
      hash.update(chunk);
      fed += chunk.length;
    }
    hash.update(enc.encode("a".repeat(1_000_000 - fed)));
    expect(hash.hex()).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("agrees with WebCrypto on every padding boundary", async () => {
    for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000]) {
      const data = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) data[i] = (i * 31 + 7) & 0xff;
      const expected = toHex(new Uint8Array(await webcrypto.subtle.digest("SHA-256", data)));
      expect(new Sha256().update(data).hex(), `length ${length}`).toBe(expected);
    }
  });

  it("stream-hashes a Blob", async () => {
    const data = new Uint8Array(9 * 1024 * 1024 + 13);
    for (let i = 0; i < data.length; i += 4096) data[i] = i & 0xff;
    const expected = toHex(new Uint8Array(await webcrypto.subtle.digest("SHA-256", data)));
    const seen: number[] = [];
    const hex = await sha256Blob(new Blob([data]), (done) => seen.push(done));
    expect(hex).toBe(expected);
    expect(seen.at(-1)).toBe(data.length);
    expect(seen.length).toBe(3);
  });
});
