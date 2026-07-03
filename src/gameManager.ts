import { Chess, type Move } from "chess.js";
import {
  declineDraw,
  getAccount,
  makeMove,
  offerOrAcceptDraw,
  resignGame,
  streamEvents,
  streamGame,
} from "./lichessClient.js";

type Color = "white" | "black";

const RECONNECT_DELAY_MS = 3000;
const MAX_GAME_RECONNECT_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyUci(chess: Chess, uci: string): Move {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci.slice(4, 5) : undefined;
  return chess.move({ from, to, promotion });
}

const UCI_RE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i;

/** Accepts "0-0"/"0-0-0" (digit zero) as aliases for the SAN "O-O"/"O-O-O" castling notation. */
function normalizeCastling(input: string): string {
  const trimmed = input.trim();
  const queenside = /^(?:o-o-o|0-0-0)([+#])?$/i.exec(trimmed);
  if (queenside) return `O-O-O${queenside[1] ?? ""}`;
  const kingside = /^(?:o-o|0-0)([+#])?$/i.exec(trimmed);
  if (kingside) return `O-O${kingside[1] ?? ""}`;
  return trimmed;
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Escapes legacy Telegram Markdown special characters in untrusted text (names, error bodies)
 * before it's interpolated into a message sent with parse_mode: "Markdown". */
export function escapeMd(text: string): string {
  return text.replace(/([_*`[])/g, "\\$1");
}

const PIECE_UNICODE: Record<string, string> = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};

/** Renders the board as a monospace diagram, oriented so the given color sits at the bottom. */
function renderBoard(chess: Chess, orientation: Color): string {
  const board = chess.board(); // board[0] = rank 8 ... board[7] = rank 1, each row a..h
  const files = orientation === "white" ? "abcdefgh".split("") : "hgfedcba".split("");
  const rankIndices = orientation === "white" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  const lines = [`  ${files.join(" ")}`];
  for (const rankIndex of rankIndices) {
    const rankNumber = 8 - rankIndex;
    const row = board[rankIndex];
    const squares = orientation === "white" ? row : [...row].reverse();
    const rowStr = squares.map((sq) => (sq ? PIECE_UNICODE[sq.color + sq.type] : "·")).join(" ");
    lines.push(`${rankNumber} ${rowStr} ${rankNumber}`);
  }
  lines.push(`  ${files.join(" ")}`);
  return lines.join("\n");
}

export class GameManager {
  private accountId: string | null = null;
  private gameId: string | null = null;
  private myColor: Color | null = null;
  private chess = new Chess();
  private appliedMoveCount = 0;
  private lastMoveSan: string | null = null;
  private opponentOfferedDraw = false;
  private whiteTimeMs: number | null = null;
  private blackTimeMs: number | null = null;

  constructor(private readonly notify: (text: string) => void) {}

  async start(): Promise<void> {
    const account = await getAccount();
    this.accountId = account.id;
    this.notify(`👋 Connected to lichess as *${escapeMd(account.username)}*. Waiting for a game to start...`);
    void this.listenEvents();
  }

  hasActiveGame(): boolean {
    return this.gameId !== null;
  }

  getActiveGameLink(): string | null {
    return this.gameId ? `https://lichess.org/${this.gameId}` : null;
  }

  private async listenEvents(): Promise<void> {
    for (;;) {
      try {
        for await (const event of streamEvents()) {
          if (event.type === "gameStart" && event.game?.id) {
            this.attachGame(event.game.id).catch((err) =>
              this.notify(`⚠️ Failed to connect to game: ${escapeMd((err as Error).message)}`),
            );
          }
        }
      } catch (err) {
        console.error("Event stream error:", err);
      }
      await sleep(RECONNECT_DELAY_MS);
    }
  }

  private async attachGame(gameId: string): Promise<void> {
    if (this.gameId === gameId) return;
    this.gameId = gameId;
    this.chess = new Chess();
    this.appliedMoveCount = 0;
    this.lastMoveSan = null;
    this.myColor = null;
    this.opponentOfferedDraw = false;
    this.whiteTimeMs = null;
    this.blackTimeMs = null;

    let attempt = 0;
    while (this.gameId === gameId) {
      try {
        for await (const msg of streamGame(gameId)) {
          if (this.gameId !== gameId) return; // superseded, or finished (gameId cleared in handleGameState)
          attempt = 0; // stream is alive and delivering data
          if (msg.type === "gameFull") {
            this.handleGameFull(msg);
          } else if (msg.type === "gameState") {
            this.handleGameState(msg);
          }
        }
        if (this.gameId !== gameId) return; // finished cleanly, already handled
        // Stream closed without a terminal status - treat like a dropped connection and retry below.
        attempt++;
      } catch (err) {
        if (this.gameId !== gameId) return;
        attempt++;
        console.error(`Game stream error (attempt ${attempt}):`, err);
      }

      if (attempt > MAX_GAME_RECONNECT_ATTEMPTS) {
        this.notify(
          `⚠️ Could not restore the connection to the game after ${MAX_GAME_RECONNECT_ATTEMPTS} attempts: https://lichess.org/${gameId}`,
        );
        this.gameId = null;
        return;
      }
      this.notify(`⚠️ Lost connection to the game, reconnecting... (attempt ${attempt}/${MAX_GAME_RECONNECT_ATTEMPTS})`);
      await sleep(RECONNECT_DELAY_MS);
    }
  }

  private handleGameFull(msg: any): void {
    const { white, black } = msg;
    this.myColor = white.id === this.accountId ? "white" : "black";
    const opponent = this.myColor === "white" ? black : white;
    const opponentName = opponent.name ?? (opponent.aiLevel ? `Stockfish (level ${opponent.aiLevel})` : "opponent");

    this.notify(
      `🏁 *Game started:* https://lichess.org/${msg.id}\n` +
        `You're playing *${this.myColor === "white" ? "white" : "black"}* against ${escapeMd(opponentName)}.`,
    );

    this.handleGameState(msg.state);
  }

  private handleGameState(state: any): void {
    const uciMoves: string[] = state.moves ? state.moves.split(" ").filter(Boolean) : [];

    const chess = new Chess();
    const sans: string[] = [];
    for (const uci of uciMoves) {
      const move = applyUci(chess, uci);
      sans.push(move.san);
    }
    this.chess = chess;
    this.lastMoveSan = sans.length > 0 ? sans[sans.length - 1] : null;

    if (typeof state.wtime === "number") this.whiteTimeMs = state.wtime;
    if (typeof state.btime === "number") this.blackTimeMs = state.btime;
    const clockSuffix =
      this.whiteTimeMs !== null && this.blackTimeMs !== null
        ? ` (⏱ white: ${formatClock(this.whiteTimeMs)}, black: ${formatClock(this.blackTimeMs)})`
        : "";

    if (uciMoves.length > this.appliedMoveCount && this.myColor) {
      for (let i = this.appliedMoveCount; i < uciMoves.length; i++) {
        const moverColor: Color = i % 2 === 0 ? "white" : "black";
        if (moverColor !== this.myColor) {
          this.notify(`♟️ *Opponent played:* ${sans[i]}${clockSuffix}`);
        }
      }
    }
    this.appliedMoveCount = uciMoves.length;

    if (this.myColor) {
      const opponentColor: Color = this.myColor === "white" ? "black" : "white";
      const opponentDrawFlag: boolean = Boolean(opponentColor === "white" ? state.wdraw : state.bdraw);
      if (opponentDrawFlag && !this.opponentOfferedDraw) {
        this.notify("🤝 *Opponent offers a draw.* Send /draw to accept, or /nodraw to decline.");
      }
      this.opponentOfferedDraw = opponentDrawFlag;
    }

    if (state.status && state.status !== "started" && state.status !== "created") {
      this.notify(this.formatGameEnd(state));
      this.gameId = null;
    }
  }

  private formatGameEnd(state: any): string {
    const statusNames: Record<string, string> = {
      mate: "checkmate",
      resign: "resignation",
      stalemate: "stalemate",
      timeout: "opponent timed out",
      draw: "draw",
      outoftime: "time ran out",
      cheat: "voided",
      noStart: "didn't start",
      aborted: "aborted",
      variantEnd: "variant ended",
    };
    const statusText = statusNames[state.status] ?? state.status;

    if (!state.winner) {
      return `🏁 *Game over:* ${statusText}.`;
    }
    const iWon = state.winner === this.myColor;
    return `🏁 *Game over:* ${statusText}. ${iWon ? "You won! 🎉" : "You lost."}`;
  }

  /** Parses and submits a user-entered move (SAN or UCI). Returns a reply string for the chat. */
  async handleUserMove(input: string): Promise<string> {
    if (!this.gameId || !this.myColor) {
      return "No active game. Start one on lichess — I'll connect automatically.";
    }

    const turnColor: Color = this.chess.turn() === "w" ? "white" : "black";
    if (turnColor !== this.myColor) {
      return "⏳ It's not your turn.";
    }

    const trimmed = normalizeCastling(input);
    const testChess = new Chess(this.chess.fen());
    let move: Move | null = null;

    try {
      move = testChess.move(trimmed);
    } catch {
      const uciMatch = UCI_RE.exec(trimmed);
      if (uciMatch) {
        try {
          move = testChess.move({ from: uciMatch[1], to: uciMatch[2], promotion: uciMatch[3] });
        } catch {
          move = null;
        }
      }
    }

    if (!move) {
      return `❓ Couldn't parse move "${escapeMd(input)}". Use SAN (e4, Nf3, O-O) or UCI (e2e4).`;
    }

    const uci = move.from + move.to + (move.promotion ?? "");
    try {
      await makeMove(this.gameId, uci);
      const clockSuffix =
        this.whiteTimeMs !== null && this.blackTimeMs !== null
          ? ` (⏱ white: ${formatClock(this.whiteTimeMs)}, black: ${formatClock(this.blackTimeMs)})`
          : "";
      return `✅ *Move sent:* ${move.san}${clockSuffix}`;
    } catch (err) {
      return `⚠️ Lichess rejected the move: ${escapeMd((err as Error).message)}`;
    }
  }

  async resign(): Promise<string> {
    if (!this.gameId) {
      return "No active game.";
    }
    try {
      await resignGame(this.gameId);
      return "🏳️ You resigned.";
    } catch (err) {
      return `⚠️ Failed to resign: ${escapeMd((err as Error).message)}`;
    }
  }

  /** Offers a draw, or accepts one already offered by the opponent. */
  async offerDraw(): Promise<string> {
    if (!this.gameId) {
      return "No active game.";
    }
    try {
      await offerOrAcceptDraw(this.gameId);
      return this.opponentOfferedDraw ? "🤝 Draw accepted." : "🤝 Draw offer sent.";
    } catch (err) {
      return `⚠️ Failed to offer a draw: ${escapeMd((err as Error).message)}`;
    }
  }

  async declineDraw(): Promise<string> {
    if (!this.gameId) {
      return "No active game.";
    }
    try {
      await declineDraw(this.gameId);
      return "Draw offer declined.";
    } catch (err) {
      return `⚠️ Failed to decline the draw: ${escapeMd((err as Error).message)}`;
    }
  }

  getStatus(): string {
    if (!this.gameId || !this.myColor) {
      return "No active game. Start one on lichess.org, or use /newgame — I'll connect automatically.";
    }
    const turnColor: Color = this.chess.turn() === "w" ? "white" : "black";
    const isMyTurn = turnColor === this.myColor;
    const turnLine = isMyTurn ? "🟢 *Your turn*" : "⏳ *Opponent's turn*";
    const clockLine =
      this.whiteTimeMs !== null && this.blackTimeMs !== null
        ? `⏱ Clock: white ${formatClock(this.whiteTimeMs)} — black ${formatClock(this.blackTimeMs)}\n`
        : "";
    const lastMoveLine = this.lastMoveSan ? `Last move: ${this.lastMoveSan}\n` : "";
    return (
      `Game: https://lichess.org/${this.gameId}\n` +
      `You're playing: ${this.myColor}\n` +
      `${turnLine}\n` +
      clockLine +
      lastMoveLine +
      "```\n" +
      renderBoard(this.chess, this.myColor) +
      "\n```\n" +
      `FEN: ${this.chess.fen()}`
    );
  }
}
