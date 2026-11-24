// Minimal YouTube IFrame Player API types (only what the app uses).

declare namespace YT {
  interface PlayerEvent {
    target: Player;
    data: number;
  }

  interface PlayerOptions {
    videoId?: string;
    playerVars?: {
      playsinline?: number;
      rel?: number;
      modestbranding?: number;
      controls?: number;
      [key: string]: number | string | undefined;
    };
    events?: {
      onReady?: (event: PlayerEvent) => void;
      onStateChange?: (event: PlayerEvent) => void;
      onError?: (event: PlayerEvent) => void;
    };
  }

  class Player {
    constructor(el: HTMLElement | string, options: PlayerOptions);
    playVideo(): void;
    pauseVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    getCurrentTime(): number;
    getPlayerState(): number;
    setPlaybackRate(rate: number): void;
    getAvailablePlaybackRates(): number[];
    destroy(): void;
  }

  enum PlayerState {
    UNSTARTED = -1,
    ENDED = 0,
    PLAYING = 1,
    PAUSED = 2,
    BUFFERING = 3,
    CUED = 5,
  }
}

interface Window {
  YT?: typeof YT;
  onYouTubeIframeAPIReady?: () => void;
}
