import { useState } from 'react';
import { parseSongText, songDurationMs, type Song, type SongSync } from '../lib/songs';
import { parseYouTubeId } from '../lib/youtube';

interface Props {
  songs: Song[];
  tempo: number; // percent of the song's BPM
  songChords: boolean;
  songClick: boolean;
  sync: Record<string, SongSync>;
  videoError: string | null;
  onTempo: (v: number) => void;
  onSongChords: (v: boolean) => void;
  onSongClick: (v: boolean) => void;
  onPlay: (song: Song) => void;
  onPlayVideo: (song: Song) => void;
  onSaveSync: (songId: string, entry: SongSync | null) => void;
  onDelete: (id: string) => void;
  onAdd: (song: { title: string; artist?: string; bpm: number; text: string }) => string | null;
}

function chordPreview(song: Song): string {
  const seen: string[] = [];
  for (const s of song.segments) {
    if (seen[seen.length - 1] !== s.chord.symbol && !seen.includes(s.chord.symbol)) {
      seen.push(s.chord.symbol);
    }
  }
  return seen.join(' · ');
}

function SyncEditor({
  song,
  sync,
  onSave,
  onClose,
}: {
  song: Song;
  sync?: SongSync;
  onSave: (songId: string, entry: SongSync | null) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(sync ? `https://youtu.be/${sync.videoId}` : '');
  const [offset, setOffset] = useState(sync?.offsetSec ?? 0);
  const [bpm, setBpm] = useState(sync?.bpm ?? song.bpm);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const videoId = parseYouTubeId(url);
    if (!videoId) {
      setError('Not a valid YouTube link or video ID');
      return;
    }
    onSave(song.id, {
      videoId,
      offsetSec: Number.isFinite(offset) ? offset : 0,
      bpm: Math.min(300, Math.max(30, bpm || song.bpm)),
    });
    onClose();
  };

  return (
    <div className="sync-editor">
      <input
        type="text"
        placeholder="Paste a YouTube link or video ID"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <div className="sync-editor-row">
        <label>
          First chord at (s)
          <input
            type="number"
            step={0.1}
            value={offset}
            onChange={(e) => setOffset(Number(e.target.value))}
          />
        </label>
        <label>
          BPM
          <input
            type="number"
            step={0.5}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
          />
        </label>
        <button className="btn btn-primary" onClick={save}>
          Save
        </button>
        {sync && (
          <button
            className="btn"
            onClick={() => {
              onSave(song.id, null);
              onClose();
            }}
          >
            Remove link
          </button>
        )}
      </div>
      {error && <div className="song-form-error">{error}</div>}
    </div>
  );
}

export default function SongsPanel({
  songs,
  tempo,
  songChords,
  songClick,
  sync,
  videoError,
  onTempo,
  onSongChords,
  onSongClick,
  onPlay,
  onPlayVideo,
  onSaveSync,
  onDelete,
  onAdd,
}: Props) {
  const [name, setName] = useState('');
  const [artist, setArtist] = useState('');
  const [bpm, setBpm] = useState(90);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const addSong = () => {
    const parsed = parseSongText(text);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    const err = onAdd({
      title: name.trim() || 'Untitled song',
      artist: artist.trim() || undefined,
      bpm: Math.min(240, Math.max(40, Math.round(bpm) || 90)),
      text,
    });
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setName('');
    setArtist('');
    setBpm(90);
    setText('');
  };

  return (
    <div className="songs-panel">
      {videoError && <div className="song-form-error songs-video-error">{videoError}</div>}
      <div className="songs-list">
        {songs.map((song) => {
          const effectiveBpm = (song.bpm * tempo) / 100;
          const secs = Math.round(songDurationMs(song, effectiveBpm) / 1000);
          const linked = !!sync[song.id];
          return (
            <div key={song.id} className="song-row-wrap">
              <div className="song-row">
                <button
                  className="song-play"
                  onClick={() => onPlay(song)}
                  aria-label={`Play ${song.title}`}
                  title="Play (synth)"
                >
                  ▶
                </button>
                <div className="song-info">
                  <div className="song-title">
                    {song.title}
                    {song.artist && <span className="song-artist">{song.artist}</span>}
                  </div>
                  <div className="song-chords" title={chordPreview(song)}>
                    {chordPreview(song)}
                  </div>
                </div>
                <div className="song-meta">
                  {song.segments.length} chords · ~{secs}s
                </div>
                {linked && (
                  <button
                    className="song-yt-play"
                    onClick={() => onPlayVideo(song)}
                    title="Play along with the linked YouTube video"
                  >
                    ▶ YouTube
                  </button>
                )}
                <button
                  className={`song-link-btn ${linked ? 'linked' : ''}`}
                  onClick={() => setEditingId(editingId === song.id ? null : song.id)}
                  aria-label={`Link a YouTube video to ${song.title}`}
                  title={linked ? 'Edit YouTube link' : 'Link a YouTube video'}
                >
                  🔗
                </button>
                {song.custom && (
                  <button className="song-delete" onClick={() => onDelete(song.id)} aria-label={`Delete ${song.title}`}>
                    ✕
                  </button>
                )}
              </div>
              {editingId === song.id && (
                <SyncEditor
                  song={song}
                  sync={sync[song.id]}
                  onSave={onSaveSync}
                  onClose={() => setEditingId(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="songs-controls">
        <label className="song-tempo">
          Tempo <strong>{tempo}%</strong>
          <input
            type="range"
            min={50}
            max={120}
            step={5}
            value={tempo}
            onChange={(e) => onTempo(Number(e.target.value))}
          />
        </label>
        <label className="song-toggle">
          <input type="checkbox" checked={songChords} onChange={(e) => onSongChords(e.target.checked)} />
          Play chords (accompaniment)
        </label>
        <label className="song-toggle">
          <input type="checkbox" checked={songClick} onChange={(e) => onSongClick(e.target.checked)} />
          Metronome click
        </label>
      </div>

      <div className="song-form">
        <h3>Your own song</h3>
        <div className="song-form-row">
          <input
            type="text"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Artist (optional)"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
          />
          <input
            type="number"
            min={40}
            max={240}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            title="BPM"
          />
        </div>
        <textarea
          placeholder="C G Am F  or  C:2 G:2 Am:4 F:4"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
        />
        {error && <div className="song-form-error">{error}</div>}
        <button className="btn btn-primary" onClick={addSong} disabled={!text.trim()}>
          Add song
        </button>
      </div>
    </div>
  );
}
