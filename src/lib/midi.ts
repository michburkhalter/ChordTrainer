import { useCallback, useEffect, useRef, useState } from 'react';

export interface MidiInputDevice {
  id: string;
  name: string;
}

export interface MidiStatus {
  /** Browser supports Web MIDI */
  supported: boolean;
  /** User granted MIDI access */
  connected: boolean;
  /** MIDI note numbers currently held down */
  activeNotes: number[];
  /** Available input devices */
  devices: MidiInputDevice[];
  /** Names of inputs currently being listened to */
  listeningTo: string[];
  error: string | null;
}

const EMPTY: MidiStatus = {
  supported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
  connected: false,
  activeNotes: [],
  devices: [],
  listeningTo: [],
  error: null,
};

function parseMidiMessage(data: Uint8Array | null, held: Set<number>) {
  if (!data || data.length < 3) return false;
  const status = data[0] & 0xf0;
  const note = data[1];
  const vel = data[2];
  let changed = false;
  if (status === 0x90 && vel > 0) {
    if (!held.has(note)) {
      held.add(note);
      changed = true;
    }
  } else if (status === 0x80 || (status === 0x90 && vel === 0)) {
    if (held.delete(note)) changed = true;
  }
  return changed;
}

/**
 * Hook that connects to all MIDI inputs (e.g. the Clavinova over USB)
 * and reports currently held notes.
 */
export function useMidiInput(): MidiStatus & { connect: () => void } {
  const [status, setStatus] = useState<MidiStatus>(EMPTY);
  const accessRef = useRef<MIDIAccess | null>(null);
  const heldRef = useRef<Set<number>>(new Set());
  const handlersRef = useRef(new Map<string, (ev: MIDIMessageEvent) => void>());

  const syncNotes = useCallback(() => {
    setStatus((s) => ({ ...s, activeNotes: [...heldRef.current].sort((a, b) => a - b) }));
  }, []);

  const attachInputs = useCallback(
    (access: MIDIAccess) => {
      const devices: MidiInputDevice[] = [];
      const listening: string[] = [];
      access.inputs.forEach((input) => {
        devices.push({ id: input.id, name: input.name || input.manufacturer || input.id });
        if (input.state === 'connected') {
          let handler = handlersRef.current.get(input.id);
          if (!handler) {
            handler = (ev: MIDIMessageEvent) => {
              if (parseMidiMessage(ev.data, heldRef.current)) syncNotes();
            };
            handlersRef.current.set(input.id, handler);
            input.addEventListener('midimessage', handler);
          }
          listening.push(input.name || input.id);
        }
      });
      setStatus((s) => ({
        ...s,
        connected: true,
        devices,
        listeningTo: listening,
        error: devices.length === 0 ? 'No MIDI input devices found' : null,
      }));
    },
    [syncNotes],
  );

  const connect = useCallback(() => {
    if (!EMPTY.supported || accessRef.current) return;
    navigator
      .requestMIDIAccess({ sysex: false })
      .then((access) => {
        accessRef.current = access;
        attachInputs(access);
        access.addEventListener('statechange', () => attachInputs(access));
      })
      .catch((err) => {
        const denied = err instanceof DOMException && err.name === 'NotAllowedError';
        setStatus((s) => ({
          ...s,
          error: denied
            ? 'MIDI permission denied. Open http://localhost:5173 in Chrome or Edge — embedded previews cannot access USB MIDI.'
            : `MIDI access failed: ${err}`,
        }));
      });
  }, [attachInputs]);

  // Detach handlers on unmount
  useEffect(() => {
    return () => {
      accessRef.current?.inputs.forEach((input) => {
        const h = handlersRef.current.get(input.id);
        if (h) input.removeEventListener('midimessage', h);
      });
    };
  }, []);

  return { ...status, connect };
}
