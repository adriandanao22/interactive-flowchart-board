/**
 * Two ways to share a chart by link.
 *
 * A *live* link is a random token pointing at a row in the database: it always
 * shows the owner's latest autosave, so a chart edited mid-demo updates for
 * everyone on reload. That half lives in `storage.ts`.
 *
 * A *snapshot* link carries the whole chart inside the URL fragment, which is
 * what this file builds. Nothing is stored and nothing is looked up, so the
 * link works with no account, no database, and no network — but it is frozen
 * at the moment it was copied.
 *
 * The fragment is deliberate: browsers never send the part after `#` to the
 * server, so a snapshot link does not end up in request logs on the way to
 * whoever you sent it to.
 */

/** Fragment key, as in `https://…/#c=<payload>`. */
export const SNAPSHOT_KEY = "c";

// First character of the payload records how the rest was encoded, so a link
// made by a browser with compression still opens in one without it.
const DEFLATED = "1";
const PLAIN = "0";

/**
 * URLs are not 8-bit clean and `btoa` chokes on anything outside Latin-1, so
 * bytes go through base64 and then have the three URL-hostile characters
 * swapped out. Padding is dropped and re-added on the way back.
 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  // Chunked: spreading a large array into `fromCharCode` overflows the stack.
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function through(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Compression is recent enough that some browsers still lack it. */
function compressionAvailable(): boolean {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}

/**
 * Pack a chart into a URL fragment payload.
 *
 * Flowchart JSON is highly repetitive — the same handful of keys on every node
 * — so deflate typically cuts it to a fifth, which is the difference between a
 * link that can be pasted into a chat message and one that cannot.
 */
export async function encodeSnapshot(json: string): Promise<string> {
  const bytes = new TextEncoder().encode(json);
  if (!compressionAvailable()) return PLAIN + toBase64Url(bytes);

  try {
    const source = new Blob([bytes as BlobPart]).stream();
    const packed = await through(source.pipeThrough(new CompressionStream("deflate-raw")));
    return DEFLATED + toBase64Url(packed);
  } catch {
    // A failure here is not worth losing the share over.
    return PLAIN + toBase64Url(bytes);
  }
}

/** Unpack a payload back to JSON text, or null if it is not a valid one. */
export async function decodeSnapshot(payload: string): Promise<string | null> {
  const marker = payload.slice(0, 1);
  const body = payload.slice(1);
  if (!body || (marker !== DEFLATED && marker !== PLAIN)) return null;

  try {
    const bytes = fromBase64Url(body);
    if (marker === PLAIN) return new TextDecoder().decode(bytes);
    if (!compressionAvailable()) return null;

    const source = new Blob([bytes as BlobPart]).stream();
    const raw = await through(source.pipeThrough(new DecompressionStream("deflate-raw")));
    return new TextDecoder().decode(raw);
  } catch {
    // Truncated by a chat client, hand-edited, or simply not one of ours.
    return null;
  }
}

/**
 * Past this the link starts getting refused — mail clients wrap it, chat apps
 * truncate it, and older servers cap the request line. The fragment never
 * reaches a server, so this is about what survives being pasted around rather
 * than a hard protocol limit.
 */
export const SNAPSHOT_WARN_LENGTH = 8000;

/** Read a snapshot payload out of a `#c=…` fragment. */
export function snapshotFromHash(hash: string): string | null {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!trimmed) return null;
  const value = new URLSearchParams(trimmed).get(SNAPSHOT_KEY);
  return value || null;
}

/** Build the full snapshot URL for a chart, given the page's own origin. */
export async function snapshotLink(origin: string, json: string): Promise<string> {
  return `${origin}/#${SNAPSHOT_KEY}=${await encodeSnapshot(json)}`;
}

/** Build the full live-link URL for a share token. */
export function liveLink(origin: string, token: string): string {
  return `${origin}/c/${token}`;
}

/**
 * A share token is a UUID, and the route accepts one straight from the URL, so
 * check the shape before it reaches the database rather than sending junk.
 */
export function isShareToken(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
