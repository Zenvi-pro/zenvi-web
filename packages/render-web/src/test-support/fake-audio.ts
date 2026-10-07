/**
 * Web Audio doubles that record what a scheduler asks for.
 */

export class FakeParam {
  value = 1;
  events: { kind: string; value: number; time: number }[] = [];
  setValueAtTime(value: number, time: number) {
    this.events.push({ kind: "set", value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ kind: "ramp", value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number) {
    this.events.push({ kind: "target", value, time });
    this.value = value;
    return this;
  }
}

export class FakeNode {
  connections: FakeNode[] = [];
  disconnected = false;
  connect(node: FakeNode) {
    this.connections.push(node);
    return node;
  }
  disconnect() {
    this.disconnected = true;
  }
}

export class FakeBuffer {
  data: Float32Array[] = [];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {}
  copyToChannel(source: Float32Array, channel: number) {
    this.data[channel] = new Float32Array(source);
  }
}

export class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  playbackRate = new FakeParam();
  started: { when: number; offset: number; duration: number } | null = null;
  stopped = false;
  onended: (() => void) | null = null;
  private listeners: (() => void)[] = [];
  start(when: number, offset: number, duration: number) {
    this.started = { when, offset, duration };
  }
  stop() {
    this.stopped = true;
  }
  addEventListener(_type: string, listener: () => void) {
    this.listeners.push(listener);
  }
  end() {
    this.onended?.();
    for (const l of this.listeners) l();
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam();
}

export class FakeAudioContext {
  currentTime = 0;
  destination = new FakeNode();
  sources: FakeBufferSource[] = [];
  gains: FakeGain[] = [];
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(channels, length, sampleRate);
  }
  createBufferSource() {
    const s = new FakeBufferSource();
    this.sources.push(s);
    return s;
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
}
