const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extract a YouTube video id from a URL or bare id.
 * Accepts youtube.com/watch?v=ID (any param order, incl. music./m. subdomains),
 * youtu.be/ID, youtube.com/shorts/ID, youtube.com/embed/ID, or a bare 11-char id.
 */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (ID_RE.test(s)) return s;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return ID_RE.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    const m = /^\/(shorts|embed|live)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
    if (m) return m[2];
    const v = url.searchParams.get('v');
    if (v && ID_RE.test(v)) return v;
  }
  return null;
}

let apiPromise: Promise<void> | null = null;

/** Load the YouTube IFrame API once; resolves when window.YT.Player is ready. */
export function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      apiPromise = null;
      reject(new Error('YouTube API load timed out'));
    }, 15000);

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      window.clearTimeout(timer);
      resolve();
    };

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
  });

  return apiPromise;
}
