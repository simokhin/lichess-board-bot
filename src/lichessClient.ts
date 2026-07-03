import { config } from "./config.js";

const LICHESS_BASE = "https://lichess.org";

/** Logs Lichess API request/response/stream activity, gated behind DEBUG_LICHESS=1. */
function debugLog(message: string): void {
  if (config.debugLichess) console.log(message);
}

async function lichessFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const bodyText = init.body instanceof URLSearchParams ? init.body.toString() : undefined;
  debugLog(`[lichess] -> ${method} ${path}${bodyText ? ` body=${bodyText}` : ""}`);
  const res = await fetch(`${LICHESS_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.lichessToken}`,
      ...init.headers,
    },
  });
  debugLog(`[lichess] <- ${res.status} ${method} ${path}`);
  return res;
}

async function lichessFetchOk(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await lichessFetch(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    debugLog(`[lichess] <- error body: ${body}`);
    throw new Error(`Lichess ${init.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return res;
}

export interface LichessAccount {
  id: string;
  username: string;
}

export async function getAccount(): Promise<LichessAccount> {
  const res = await lichessFetchOk("/api/account");
  return res.json() as Promise<LichessAccount>;
}

/** Parses a newline-delimited JSON HTTP stream, yielding one object per non-empty line. */
async function* streamNdjson(path: string): AsyncGenerator<any> {
  const res = await lichessFetchOk(path);
  if (!res.body) {
    throw new Error(`Stream ${path} returned no body`);
  }
  debugLog(`[lichess] stream open: ${path}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          debugLog(`[lichess] stream ${path} <- ${line}`);
          yield JSON.parse(line);
        } else {
          debugLog(`[lichess] stream ${path} <- (heartbeat)`);
        }
      }
    }
  } finally {
    reader.releaseLock();
    debugLog(`[lichess] stream closed: ${path}`);
  }
}

/** Streams account-level events: gameStart, gameFinish, challenge, etc. Runs until the connection drops. */
export function streamEvents(): AsyncGenerator<any> {
  return streamNdjson("/api/stream/event");
}

/** Streams full state + updates for a single game (Board API). */
export function streamGame(gameId: string): AsyncGenerator<any> {
  return streamNdjson(`/api/board/game/stream/${gameId}`);
}

/** Submits a move in UCI format (e.g. "e2e4", "e7e8q"). */
export async function makeMove(gameId: string, uci: string): Promise<void> {
  await lichessFetchOk(`/api/board/game/${gameId}/move/${uci}`, { method: "POST" });
}

export async function resignGame(gameId: string): Promise<void> {
  await lichessFetchOk(`/api/board/game/${gameId}/resign`, { method: "POST" });
}

/** Offers a draw, or accepts one already offered by the opponent. */
export async function offerOrAcceptDraw(gameId: string): Promise<void> {
  await lichessFetchOk(`/api/board/game/${gameId}/draw/yes`, { method: "POST" });
}

/** Declines a draw offered by the opponent. */
export async function declineDraw(gameId: string): Promise<void> {
  await lichessFetchOk(`/api/board/game/${gameId}/draw/no`, { method: "POST" });
}

export interface TimeControl {
  minutes: number;
  increment: number;
}

/**
 * Places a real-time seek for a random opponent. The underlying HTTP request must stay open
 * for the seek to remain active, so this resolves only once matched, cancelled, or timed out;
 * callers should not await it before responding to the user.
 */
export async function seekGame(params: TimeControl & { rated: boolean }): Promise<void> {
  const body = new URLSearchParams({
    rated: String(params.rated),
    time: String(params.minutes),
    increment: String(params.increment),
  });
  const res = await lichessFetchOk("/api/board/seek", { method: "POST", body });
  if (!res.body) return;
  debugLog("[lichess] seek stream open: /api/board/seek");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true }).trim();
      debugLog(`[lichess] seek stream <- ${text ? text : "(heartbeat)"}`);
    }
  } finally {
    reader.releaseLock();
    debugLog("[lichess] seek stream closed: /api/board/seek");
  }
}

/** Sends a direct challenge to another lichess user; the game starts once they accept. */
export async function challengeUser(username: string, params: TimeControl & { rated: boolean }): Promise<void> {
  const body = new URLSearchParams({
    rated: String(params.rated),
    "clock.limit": String(params.minutes * 60),
    "clock.increment": String(params.increment),
  });
  await lichessFetchOk(`/api/challenge/${encodeURIComponent(username)}`, { method: "POST", body });
}
