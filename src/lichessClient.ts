import { config } from "./config.js";

const LICHESS_BASE = "https://lichess.org";

async function lichessFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${LICHESS_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.lichessToken}`,
      ...init.headers,
    },
  });
  return res;
}

async function lichessFetchOk(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await lichessFetch(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
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
        if (line) yield JSON.parse(line);
      }
    }
  } finally {
    reader.releaseLock();
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
