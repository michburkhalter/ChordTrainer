// Minimal Web MIDI API declarations (not covered by TS's DOM lib)

interface MIDIMessageEvent extends Event {
  data: Uint8Array | null;
}

interface MIDIInput extends EventTarget {
  id: string;
  name?: string;
  manufacturer?: string;
  state: string;
}

interface MIDIOutput extends EventTarget {
  id: string;
  name?: string;
  manufacturer?: string;
  state: string;
  send(data: number[] | Uint8Array, timestamp?: number): void;
}

interface MIDIInputMap {
  size: number;
  forEach(callbackfn: (value: MIDIInput, key: string, parent: MIDIInputMap) => void): void;
  get(key: string): MIDIInput | undefined;
  has(key: string): boolean;
  keys(): IterableIterator<string>;
  values(): IterableIterator<MIDIInput>;
  entries(): IterableIterator<[string, MIDIInput]>;
  [Symbol.iterator](): IterableIterator<[string, MIDIInput]>;
}

interface MIDIOutputMap {
  size: number;
  forEach(callbackfn: (value: MIDIOutput, key: string, parent: MIDIOutputMap) => void): void;
  get(key: string): MIDIOutput | undefined;
  has(key: string): boolean;
  keys(): IterableIterator<string>;
  values(): IterableIterator<MIDIOutput>;
  entries(): IterableIterator<[string, MIDIOutput]>;
  [Symbol.iterator](): IterableIterator<[string, MIDIOutput]>;
}

interface MIDIAccess extends EventTarget {
  inputs: MIDIInputMap;
  outputs: MIDIOutputMap;
  sysexEnabled: boolean;
}

interface Navigator {
  requestMIDIAccess(options?: { sysex?: boolean }): Promise<MIDIAccess>;
}
