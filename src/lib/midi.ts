import { useCallback, useEffect, useRef, useState } from 'react';

export interface MidiInputDevice {
  id: string;
  name: string;
}

export interface MidiOutputDevice {
  id: string;
  name: string;
}

export interface MidiStatus {
  /** Browser supports Web MIDI */
  supported: boolean;
  /** User granted MIDI access */
  connected: boolean;
  /** SysEx messages are permitted (needed for LED control) */
  sysex: boolean;
  /** MIDI note numbers currently held down */
  activeNotes: number[];
  /** Available input devices */
  devices: MidiInputDevice[];
  /** Available output devices */
  outputs: MidiOutputDevice[];
  /** Names of inputs currently being listened to */
  listeningTo: string[];
  error: string | null;
}

const EMPTY: MidiStatus = {
  supported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
  connected: false,
  sysex: false,
  activeNotes: [],
  devices: [],
  outputs: [],
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
 * and reports currently held notes. Also exposes MIDI OUT for SysEx
 * commands such as the CSP key-light control.
 */
export function useMidiInput(): MidiStatus & { connect: () => void; send: (data: number[]) => boolean } {
  const [status, setStatus] = useState<MidiStatus>(EMPTY);
  const accessRef = useRef<MIDIAccess | null>(null);
  const heldRef = useRef<Set<number>>(new Set());
  const handlersRef = useRef(new Map<string, (ev: MIDIMessageEvent) => void>());
  const outputsRef = useRef<MIDIOutput[]>([]);
  const inputNamesRef = useRef<string[]>([]);

  const syncNotes = useCallback(() => {
    setStatus((s) => ({ ...s, activeNotes: [...heldRef.current].sort((a, b) => a - b) }));
  }, []);

  const attachInputs = useCallback(
    (access: MIDIAccess) => {
      const devices: MidiInputDevice[] = [];
      const listening: string[] = [];
      inputNamesRef.current = [];
      outputsRef.current = [];
      access.inputs.forEach((input) => {
        devices.push({ id: input.id, name: input.name || input.manufacturer || input.id });
        if (input.state === 'connected') {
          inputNamesRef.current.push(input.name || '');
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
      const outputs: MidiOutputDevice[] = [];
      access.outputs.forEach((output) => {
        if (output.state === 'connected') {
          outputs.push({ id: output.id, name: output.name || output.manufacturer || output.id });
          outputsRef.current.push(output);
        }
      });
      setStatus((s) => ({
        ...s,
        connected: true,
        devices,
        outputs,
        listeningTo: listening,
        error: null,
      }));
    },
    [syncNotes],
  );

  /**
   * Send raw MIDI bytes to the piano. Picks the output whose name matches a
   * connected input (the CSP's USB port is bidirectional); falls back to the
   * first output.
   */
  const send = useCallback((data: number[]): boolean => {
    const outputs = outputsRef.current;
    if (outputs.length === 0) return false;
    const names = inputNamesRef.current.map((n) => n.toLowerCase());
    let out =
      outputs.find((o) => names.some((n) => n && o.name && (o.name.toLowerCase().includes(n) || n.includes(o.name.toLowerCase())))) ??
      outputs[0];
    try {
      out.send(data);
      return true;
    } catch {
      return false;
    }
  }, []);

  const connect = useCallback(() => {
    if (!EMPTY.supported || accessRef.current) return;
    const tryAccess = (sysex: boolean) => {
      navigator
        .requestMIDIAccess({ sysex })
        .then((access) => {
          accessRef.current = access;
          setStatus((s) => ({ ...s, sysex }));
          attachInputs(access);
          access.addEventListener('statechange', () => attachInputs(access));
        })
        .catch((err) => {
          if (sysex) {
            tryAccess(false); // retry without SysEx so note input still works
          } else {
            const denied = err instanceof DOMException && err.name === 'NotAllowedError';
            setStatus((s) => ({
              ...s,
              error: denied
                ? 'MIDI permission denied. Open http://localhost:5173 in Chrome or Edge — embedded previews cannot access USB MIDI.'
                : `MIDI access failed: ${err}`,
            }));
          }
        });
    };
    tryAccess(true);
  }, [attachInputs]);

  // Auto-connect on mount; connect() no-ops where Web MIDI is unsupported
  useEffect(() => {
    connect();
  }, [connect]);

  // Detach handlers on unmount
  useEffect(() => {
    return () => {
      accessRef.current?.inputs.forEach((input) => {
        const h = handlersRef.current.get(input.id);
        if (h) input.removeEventListener('midimessage', h);
      });
    };
  }, []);

  return { ...status, connect, send };
}
