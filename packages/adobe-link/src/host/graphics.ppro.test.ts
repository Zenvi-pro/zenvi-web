import { describe, expect, test } from "vitest";
import { pngHead } from "../testing/ppro-qe.js";
import { loadPremiere, standardEdit } from "../testing/ppro-fixtures.js";
import { TICKS_PER_SECOND } from "../testing/premiere-mock.js";

describe("premiere_add_text with a PNG title", () => {
  test("imports the PNG and places it on the first free track above V1 for the TASTE reading time", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const png = fx.file("title.png", pngHead(1920, 1080));
    edit.sequence.setPlayerPosition(String(2 * TICKS_PER_SECOND));
    const receipt = fx.call("premiere_add_text", { text: "Launch day", image: png });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe('Added the title "Launch day" on V2 at 2 s for 3 s (image)');
    expect(receipt.data).toMatchObject({ source: "image", style: "title", font_size: 72, color: "#F7F7F5", placement: "center", reading_time: 2.1, imported: true });
    const title = edit.sequence.videoTrackList[1]?.clipList[0];
    expect(title?.span).toMatchObject({ start: 2, end: 5 });
    expect(title?.componentList[1]?.param("Scale").value).toBe(100);
  });

  test("a lower third uses its 5 s hold and the lower-third size; a smaller PNG is scaled to the frame width", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    edit.sequence.videoTrackList[1]?.addClip(edit.items.a, 0, 3);
    const png = fx.file("name.png", pngHead(960, 540));
    const receipt = fx.call("premiere_add_text", { text: "Ada Lovelace", style: "lower-third", image: png, time: 1 });
    expect(receipt.data).toMatchObject({ font_size: 54, placement: "lower-third" });
    const title = edit.sequence.videoTrackList[2]?.clipList[0];
    expect(title?.span).toMatchObject({ start: 1, end: 6 });
    expect(title?.componentList[1]?.param("Scale").value).toBe(200);
    expect(receipt.warnings).toContain("Scaled the 960x540 image to 200%");
    expect(receipt.data.layout).toEqual({ scale: 200, position: [960, 540] });
  });

  test("a graphic smaller than the frame keeps its size and sits at its placement inside title-safe", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const png = fx.file("name.png", pngHead(600, 120));
    const receipt = fx.call("premiere_add_text", { text: "Ada Lovelace", style: "lower-third", image: png, time: 0 });
    // Left edge on title-safe x (10 % of 1920), bottom at 80 % of the height.
    expect(receipt.data.layout).toEqual({ scale: 100, position: [492, 804] });
    const motion = edit.sequence.videoTrackList[1]?.clipList[0]?.componentList[1];
    expect(motion?.param("Position").value).toEqual([492 / 1920, 804 / 1080]);
    expect(motion?.param("Scale").calls).toEqual([]);
    expect(receipt.warnings).toEqual([]);
  });

  test("vertical frames keep graphics clear of the top 12 %; oversized graphics shrink to fit title-safe", () => {
    const fx = loadPremiere();
    fx.mock.project.addSequence({ name: "Reel", width: 1080, height: 1920, fps: 30 });
    const top = fx.call("premiere_add_text", { text: "Hook", image: fx.file("hook.png", pngHead(800, 200)), placement: "top-center", time: 0 });
    expect(top.data.layout).toEqual({ scale: 100, position: [540, 330.4] });
    const wide = fx.call("premiere_add_text", { text: "Wide", image: fx.file("wide.png", pngHead(2000, 400)), time: 4 });
    expect(wide.data.layout).toEqual({ scale: 43.2, position: [540, 960] });
    expect(wide.warnings).toContain("Scaled the 2000x400 image to 43.2%");
  });

  test("vertical sequences keep the 1080-wide type scale; short durations warn about reading time", () => {
    const fx = loadPremiere();
    fx.mock.project.addSequence({ name: "Reel", width: 1080, height: 1920, fps: 30 });
    const png = fx.file("hook.png", pngHead(1080, 1920));
    const receipt = fx.call("premiere_add_text", { text: "Three things nobody tells you", style: "headline", image: png, duration: 1, time: 0 });
    expect(receipt.data).toMatchObject({ font_size: 96 });
    expect(receipt.warnings).toEqual(["On screen for 1 s, under the 3 s reading time for 5 words (TASTE: 1.5 s + 0.3 s per word)"]);
  });

  test("refusals: neither image nor mogrt, both, missing file, busy explicit track, no free track", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const png = fx.file("title.png", pngHead(1920, 1080));
    const none = fx.call("premiere_add_text", { text: "Hello" });
    expect(none.error?.code).toBe("UNSUPPORTED");
    expect(none.summary).toContain("Pass `image` (a transparent PNG title at the sequence size, 1920x1080");
    expect(fx.call("premiere_add_text", { text: "Hello", image: png, mogrt: png }).error?.code).toBe("INVALID_ARGUMENT");
    expect(fx.call("premiere_add_text", { text: "Hello", image: "/nope/x.png" }).error?.code).toBe("NOT_FOUND");
    expect(fx.call("premiere_add_text", { text: "Hello", image: png, track: 0, time: 1 }).summary).toContain("Track V1 already has a clip");
    edit.sequence.videoTrackList[1]?.addClip(edit.items.a, 0, 12);
    edit.sequence.videoTrackList[2]?.addClip(edit.items.b, 0, 12);
    expect(fx.call("premiere_add_text", { text: "Hello", image: png, time: 1 }).summary).toContain("No video track above V1 is free");
  });
});

describe("premiere_add_text with a MOGRT", () => {
  test("an After Effects-authored template gets the text (JSON textEditValue), size and colour", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const mogrt = fx.file("Lower Third.mogrt");
    fx.mock.state.mogrts.set(mogrt, {
      duration: 10,
      params: [
        ["Name Text", JSON.stringify({ textEditValue: "Name", fontTextRunLength: [4], fontSizeEditValue: [60] })],
        ["Text Size", 60],
        ["Fill Color", null],
      ],
    });
    const receipt = fx.call("premiere_add_text", { text: "Ada Lovelace", style: "lower-third", mogrt, time: 2, color: "#FF5A36" });
    expect(receipt.status).toBe("applied");
    expect(receipt.data).toMatchObject({ source: "mogrt", placement: "template" });
    const clip = edit.sequence.videoTrackList[1]?.clipList[0];
    const text = JSON.parse(String(clip?.mgt?.param("Name Text").value)) as Record<string, unknown>;
    expect(text).toEqual({ textEditValue: "Ada Lovelace", fontTextRunLength: [12], fontSizeEditValue: [60] });
    expect(clip?.mgt?.param("Text Size").value).toBe(54);
    expect(clip?.mgt?.param("Fill Color").color).toEqual([255, 255, 90, 54]);
    expect(clip?.span).toMatchObject({ start: 2, end: 7 });
    expect(fx.mock.state.calls).toContain(`importMGT(Lower Third.mogrt, ${2 * TICKS_PER_SECOND}, 1)`);
  });

  test("a Premiere-authored template has no scriptable text: it is removed again and the call refused", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const mogrt = fx.file("Basic Title.mogrt");
    fx.mock.state.mogrts.set(mogrt, { duration: 5, params: null });
    const receipt = fx.call("premiere_add_text", { text: "Hello", mogrt, time: 1 });
    expect(receipt.error?.code).toBe("UNSUPPORTED");
    expect(receipt.summary).toContain("has no scriptable text");
    expect(receipt.warnings.join(" ")).toContain("its own undo step");
    expect(edit.sequence.videoTrackList[1]?.clipList).toEqual([]);
  });
});

describe("premiere_add_captions", () => {
  test("imports the SRT and creates a subtitle caption track at the time", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const srt = fx.file("talk.srt", "1\n00:00:00,000 --> 00:00:02,000\nHello\n");
    const receipt = fx.call("premiere_add_captions", { srt, time: 1 });
    expect(receipt.status).toBe("applied");
    expect(receipt.summary).toBe('Added a subtitle caption track from "talk.srt" at 1 s to "Main"');
    expect(edit.sequence.captionTracks).toEqual([{ item: (receipt.data.item as { node_id: string }).node_id, start: 1, format: 0 }]);
    expect(receipt.data.imported).toBe(true);
    const again = fx.call("premiere_add_captions", { srt, format: "cea-708" });
    expect(again.data).toMatchObject({ imported: false, format: "cea-708" });
    expect(edit.sequence.captionTracks[1]?.format).toBe(2);
  });

  test("refusals: not an .srt, missing file, no createCaptionTrack", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    expect(fx.call("premiere_add_captions", { srt: fx.file("talk.vtt") }).error?.code).toBe("INVALID_ARGUMENT");
    expect(fx.call("premiere_add_captions", { srt: "/nope/talk.srt" }).error?.code).toBe("NOT_FOUND");
    (edit.sequence as unknown as Record<string, unknown>).createCaptionTrack = undefined;
    const old = fx.call("premiere_add_captions", { srt: fx.file("talk.srt") });
    expect(old.error?.code).toBe("UNSUPPORTED");
    expect(old.summary).toContain("needs Premiere Pro 2021 (15.0) or later");
  });
});

describe("premiere_add_text leaves the rest of the track alone", () => {
  test("an image is marked to the title's length before it is laid down, so the next clip keeps its span", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const next = edit.sequence.videoTrackList[1]?.addClip(edit.items.c, 5, 8);
    const png = fx.file("title.png", pngHead(1920, 1080));
    const receipt = fx.call("premiere_add_text", { text: "Launch day", image: png, time: 1, track: 1 });
    expect(receipt.status).toBe("applied");
    expect(next?.span).toMatchObject({ start: 5, end: 8 });
    expect(edit.sequence.videoTrackList[1]?.clipList.map((clip) => [clip.name, clip.span.start, clip.span.end])).toEqual([
      ["title.png", 1, 4],
      ["c.mov", 5, 8],
    ]);
    const item = fx.mock.project.findByMediaPath(png);
    expect(item?.markCalls).toEqual(["in=0@4", "out=3@4", "in=0@4", "out=5@4"]);
  });

  test("a template needs a track that is free from its start onward", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const mogrt = fx.file("Lower Third.mogrt");
    fx.mock.state.mogrts.set(mogrt, { duration: 10, params: [["Name Text", "Name"]] });
    const later = edit.sequence.videoTrackList[1]?.addClip(edit.items.c, 6, 9);
    const auto = fx.call("premiere_add_text", { text: "Ada", style: "lower-third", mogrt, time: 0 });
    expect(auto.status).toBe("applied");
    expect((auto.data.clip as { track: { index: number } }).track.index).toBe(2);
    expect(later?.span).toMatchObject({ start: 6, end: 9 });
    const fx2 = loadPremiere();
    const edit2 = standardEdit(fx2);
    fx2.mock.state.mogrts.set(mogrt, { duration: 10, params: [["Name Text", "Name"]] });
    edit2.sequence.videoTrackList[1]?.addClip(edit2.items.c, 6, 9);
    const explicit = fx2.call("premiere_add_text", { text: "Ada", mogrt, time: 0, track: 1 });
    expect(explicit.summary).toContain("already has a clip after 0 s (a template needs room for its own length)");
  });

  test("if Premiere still changes a neighbour the call fails loudly", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const track = edit.sequence.videoTrackList[1];
    track?.addClip(edit.items.c, 5, 8);
    if (track) {
      const overwrite = track.overwriteClip.bind(track);
      track.overwriteClip = (item, time) => {
        const placed = overwrite(item, time);
        track.clearRange(5 * 254016000000, 6 * 254016000000);
        return placed;
      };
    }
    const receipt = fx.call("premiere_add_text", { text: "Hi", image: fx.file("t.png", pngHead(1920, 1080)), time: 1, track: 1 });
    expect(receipt).toMatchObject({ status: "error", error: { code: "HOST_ERROR" } });
    expect(receipt.summary).toContain("changed other clips on V2");
  });

  test("the template's string text control is used, not a control merely named like text", () => {
    const fx = loadPremiere();
    const edit = standardEdit(fx);
    const mogrt = fx.file("Card.mogrt");
    fx.mock.state.mogrts.set(mogrt, { duration: 10, params: [["Text Size", 60], ["Title", "Title"]] });
    const receipt = fx.call("premiere_add_text", { text: "Ada Lovelace", mogrt, time: 0 });
    expect(receipt.status).toBe("applied");
    const clip = edit.sequence.videoTrackList[1]?.clipList[0];
    expect(clip?.mgt?.param("Title").value).toBe("Ada Lovelace");
    expect(clip?.mgt?.param("Text Size").value).toBe(72);
  });

  test("the receipt reports how long the title really runs", () => {
    const fx = loadPremiere();
    standardEdit(fx);
    const mogrt = fx.file("Short.mogrt");
    fx.mock.state.mogrts.set(mogrt, { duration: 2, params: [["Source Text", "x"]] });
    const receipt = fx.call("premiere_add_text", { text: "Hello", mogrt, time: 0, duration: 4 });
    expect(receipt.summary).toContain("for 2 s (template)");
    expect(receipt.warnings).toContain("The title runs 2 s, not 4 s (the template is shorter)");
  });
});
