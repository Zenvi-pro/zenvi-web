---
id: cut-on-action
kind: technique
summary: "When a process should flow: hide each cut inside a gesture so the next shot starts mid-move at a new scale."
categories: [food-recipe, real-estate-tour, wedding-event-film]
tools: [search_clip_scenes_tool, slice_clip_at_best_match_tool, trim_clip_tool, watch_clip_window_tool, set_clip_properties_tool, add_sfx_tool]
pace: medium
mood: [smooth, crafted, tactile]
aspect: ["9:16", "16:9", "4:5", "1:1"]
pairs_with: [cuts-on-audio-transients, action-per-cut-micro-demo-with-live-foley, motion-pose-or-position-match-cut]
avoid_with: [split-screen-compare-layout]
needs: [motion-peak-cut-snap]
---

# Cut on action

## What it is
A cut that the eye does not see: the knife comes down in the wide and lands
in the close; the hand reaches for the fridge and opens it in the next shot.
Movement carries across the join, so a montage of a process feels continuous.

## Build it in Zenvi
1. Find the gesture in each clip: `search_clip_scenes_tool {"query": "knife chopping
   pepper"}` and `slice_clip_at_best_match_tool`, or watch the window
   (`watch_clip_window_tool`, `preview_frame`).
2. Outgoing shot ends 2-4 frames into the gesture; incoming starts at the same
   phase of the same gesture: `trim_clip_tool {"clip_id": "<clip_id>", "start_seconds": "<start_seconds>", "end_seconds": "<end_seconds>"}`.
3. Same take, two scales (one camera): duplicate the moment and push the second
   piece in, `set_clip_properties_tool {"properties": {"scale_x": 1.6, "scale_y": 1.6,
   "location_y": -0.05}}`; a scale change of 1.5x or more, else it reads as a jump.
4. A strike sound on the impact frame (`add_sfx_tool` `hit_transient` -14 dB)
   seals the cut.

## Timing & taste rules
- Cut 2-4 frames after the move starts; never on a still frame.
- Direction holds across the cut (hand moving right stays moving right).
- Scale changes by at least 1.5x (wide → close or close → insert).
- No snap-to-motion-peak tool yet (`motion-peak-cut-snap`): pick the frame
  by eye.

## Sound for it
The action's own sound across the cut (L-cut the source audio a few frames),
or one designed transient on the impact.

## Common mistakes
- Switching to a different subject mid-gesture (the test's herbs → ice tray
  cut "halted the velocity", said the judge).
- Same scale on both sides: a jump cut.

## Verified
2026-10-28: 6 s test, wide pepper chop → 1.6x push on the same chop
mid-stroke → herbs chop → herbs into a tray, hits on the cuts. Contact sheet:
the push lands mid-stroke. Watch judge overall 3.45; fixes: keep subject and
direction across every join (the last two cuts changed subject).
