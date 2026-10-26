/** When each turn of chat_thread happens: typing, sending, typing dots and streaming, fitted to the block's length. */

export type Role = "user" | "assistant";

export interface Turn {
  role: Role;
  /** Characters typed (user) or words streamed (assistant). */
  units: number;
}

export interface TurnTime {
  role: Role;
  /** User: typing starts. Assistant: the dots appear. */
  start: number;
  /** User: the bubble is sent. Assistant: streaming starts. */
  send: number;
  /** The last character/word is in. */
  end: number;
}

export interface ChatPlan {
  turns: TurnTime[];
  /** Characters per second typed, words per second streamed. */
  cps: number;
  wps: number;
}

const ENTER = 0.5;
const USER_GAP = 0.3 + 0.35; // pause before send + after the bubble lands
const AI_DOTS = 0.8;
const AI_GAP = 0.35;
/** A brisk typist and a readable stream, before fitting. */
const CPS = 22;
const WPS = 9;

/**
 * Times for `turns` inside `seconds`, leaving `tail` seconds at the end
 * (the marker sweep, the hold and the exit). Typing and streaming speed up
 * together when the conversation would not fit, up to 4× (past that the
 * block simply needs to be longer).
 */
export function planChat(turns: readonly Turn[], seconds: number, tail: number): ChatPlan {
  const fixed = ENTER + turns.reduce((a, t) => a + (t.role === "user" ? USER_GAP : AI_DOTS + AI_GAP), 0) + tail;
  const variable = turns.reduce((a, t) => a + (t.role === "user" ? t.units / CPS : t.units / WPS), 0);
  const room = Math.max(0.3, seconds - fixed);
  const speed = Math.min(4, Math.max(1, variable / room));
  const cps = CPS * speed;
  const wps = WPS * speed;
  let t = ENTER;
  const out: TurnTime[] = turns.map((turn) => {
    if (turn.role === "user") {
      const start = t;
      const end = start + turn.units / cps;
      const send = end + 0.3;
      t = send + 0.35;
      return { role: turn.role, start, send, end };
    }
    const start = t;
    const send = start + AI_DOTS;
    const end = send + turn.units / wps;
    t = end + AI_GAP;
    return { role: turn.role, start, send, end };
  });
  return { turns: out, cps, wps };
}
