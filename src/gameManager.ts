import { Chess } from "chess.js";
import { parseMoveInput, renderBoard, replayMoves, type Color } from "./chessUtils.js";
import { escapeMd, formatClock } from "./format.js";
import {
  declineDraw,
  getAccount,
  getCurrentGameId,
  makeMove,
  offerOrAcceptDraw,
  resignGame,
  streamEvents,
  streamGame,
} from "./lichessClient.js";

const RECONNECT_DELAY_MS = 3000;
const MAX_GAME_RECONNECT_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    console.log(await this.syncActiveGame());
  }

  /**
   * Checks lichess for a game already in progress and attaches to it if we aren't already
   * tracking one. Runs on startup to catch a game that started (or that we missed the
   * gameStart event for) while the bot wasn't connected; can also be triggered manually via
   * /sync to recover without restarting the process.
   */
  async syncActiveGame(): Promise<string> {
    if (this.gameId !== null) {
      return `Already tracking a game: ${this.getActiveGameLink()}`;
    }
    const currentGameId = await getCurrentGameId();
    if (!currentGameId) {
      return "No game in progress on lichess right now.";
    }
    this.attachGame(currentGameId).catch((err) =>
      this.notify(`⚠️ Failed to connect to game: ${escapeMd((err as Error).message)}`),
    );
    return `🔄 Found a game in progress, connecting: https://lichess.org/${currentGameId}`;
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
          if (event.type !== "gameStart" || !event.game?.id) continue;
          const incomingGameId: string = event.game.id;

          if (this.gameId !== null && this.gameId !== incomingGameId) {
            this.notify(
              `⚠️ Another game started while one is already active — ignoring it for now: ` +
                `https://lichess.org/${incomingGameId}\n` +
                `Finish or resign your current game first: ${this.getActiveGameLink()}`,
            );
            continue;
          }

          this.attachGame(incomingGameId).catch((err) =>
            this.notify(`⚠️ Failed to connect to game: ${escapeMd((err as Error).message)}`),
          );
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

    const { chess, sans } = replayMoves(uciMoves);
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

    const move = parseMoveInput(this.chess.fen(), input);
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
