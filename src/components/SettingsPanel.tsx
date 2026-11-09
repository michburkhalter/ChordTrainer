import { useEffect, useMemo, useState } from 'react';
import { ALL_CHORDS, NOTE_NAMES } from '../lib/theory';
import type { Chord } from '../lib/theory';

interface Props {
  open: boolean;
  enabled: Set<string>;
  allowExtra: boolean;
  onApply: (next: Set<string>, allowExtra: boolean) => void;
  onClose: () => void;
}

const OPEN_CHORDS = ['C', 'G', 'F', 'A', 'Dm', 'Am', 'Em'];

export default function SettingsPanel({ open, enabled, allowExtra, onApply, onClose }: Props) {
  const [draft, setDraft] = useState<Set<string>>(new Set(enabled));
  const [extraDraft, setExtraDraft] = useState(allowExtra);

  // Reset the draft whenever the panel is opened
  useEffect(() => {
    if (open) {
      setDraft(new Set(enabled));
      setExtraDraft(allowExtra);
    }
  }, [open, enabled, allowExtra]);

  const groups = useMemo(() => {
    const byRoot = new Map<number, Chord[]>();
    for (const c of ALL_CHORDS) {
      const list = byRoot.get(c.root) ?? [];
      list.push(c);
      byRoot.set(c.root, list);
    }
    return [...byRoot.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([root, chords]) => ({ root, chords }));
  }, []);

  if (!open) return null;

  const toggle = (symbol: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const setAll = (on: boolean) => {
    setDraft(on ? new Set(ALL_CHORDS.map((c) => c.symbol)) : new Set());
  };

  const setQuality = (quality: 'major' | 'minor') => {
    setDraft(new Set(ALL_CHORDS.filter((c) => c.quality === quality).map((c) => c.symbol)));
  };

  const setPreset = (symbols: string[]) => {
    setDraft(new Set(symbols));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Chord settings</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="modal-sub">
          Select the chords you want to practice. Deselected chords are skipped.
        </p>

        <label className="setting-row">
          <input
            type="checkbox"
            checked={extraDraft}
            onChange={(e) => setExtraDraft(e.target.checked)}
          />
          <span>
            Allow extra notes
            <em>Notes outside the chord won't break the hold</em>
          </span>
        </label>

        <div className="chord-grid">
          {groups.map(({ root, chords }) => (
            <div className="chord-group" key={root}>
              <div className="chord-group-label">{NOTE_NAMES[root]}</div>
              <div className="chord-group-chords">
                {chords.map((c) => {
                  const on = draft.has(c.symbol);
                  return (
                    <button
                      key={c.symbol}
                      className={`chord-toggle ${on ? 'on' : 'off'}`}
                      onClick={() => toggle(c.symbol)}
                      aria-pressed={on}
                    >
                      {c.symbol}
                      <span className="chord-toggle-quality">
                        {c.quality === 'minor' ? 'minor' : 'major'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <span className="modal-count">
            {draft.size} of {ALL_CHORDS.length} chords enabled
          </span>
          <div className="modal-actions">
            <button className="btn" onClick={() => setQuality('major')}>
              Majors
            </button>
            <button className="btn" onClick={() => setQuality('minor')}>
              Minors
            </button>
            <button className="btn" onClick={() => setPreset(OPEN_CHORDS)} title="C G F A · Dm Am Em">
              Open
            </button>
            <button className="btn" onClick={() => setAll(true)}>
              All
            </button>
            <button className="btn" onClick={() => setAll(false)}>
              None
            </button>
            <button className="btn btn-primary" onClick={() => onApply(draft, extraDraft)} disabled={draft.size === 0}>
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
