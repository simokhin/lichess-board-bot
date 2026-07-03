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

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export class GameManager {
  private accountId: string | null = null;
  private gameId: string | null = null;
  private myColor: Color | null = null;
  private chess = new Chess();
  private appliedMoveCount = 0;
  private opponentOfferedDraw = false;
  private whiteTimeMs: number | null = null;
  private blackTimeMs: number | null = null;

  constructor(private readonly notify: (text: string) => void) {}

  async start(): Promise<void> {
    const account = await getAccount();
    this.accountId = account.id;
    this.notify(`Подключен к lichess как ${account.username}. Жду начала партии...`);
    void this.listenEvents();
  }

  private async listenEvents(): Promise<void> {
    for (;;) {
      try {
        for await (const event of streamEvents()) {
          if (event.type === "gameStart" && event.game?.id) {
            this.attachGame(event.game.id).catch((err) =>
              this.notify(`Ошибка подключения к игре: ${(err as Error).message}`),
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
          `Не удалось восстановить соединение с партией после ${MAX_GAME_RECONNECT_ATTEMPTS} попыток: https://lichess.org/${gameId}`,
        );
        this.gameId = null;
        return;
      }
      this.notify(`Связь с партией прервана, переподключаюсь... (попытка ${attempt}/${MAX_GAME_RECONNECT_ATTEMPTS})`);
      await sleep(RECONNECT_DELAY_MS);
    }
  }

  private handleGameFull(msg: any): void {
    const { white, black } = msg;
    this.myColor = white.id === this.accountId ? "white" : "black";
    const opponent = this.myColor === "white" ? black : white;
    const opponentName = opponent.name ?? (opponent.aiLevel ? `Stockfish (уровень ${opponent.aiLevel})` : "соперник");

    this.notify(
      `Партия началась: https://lichess.org/${msg.id}\n` +
        `Вы играете за ${this.myColor === "white" ? "белых" : "чёрных"} против ${opponentName}.`,
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

    if (typeof state.wtime === "number") this.whiteTimeMs = state.wtime;
    if (typeof state.btime === "number") this.blackTimeMs = state.btime;
    const clockSuffix =
      this.whiteTimeMs !== null && this.blackTimeMs !== null
        ? ` (белые: ${formatClock(this.whiteTimeMs)}, чёрные: ${formatClock(this.blackTimeMs)})`
        : "";

    if (uciMoves.length > this.appliedMoveCount && this.myColor) {
      for (let i = this.appliedMoveCount; i < uciMoves.length; i++) {
        const moverColor: Color = i % 2 === 0 ? "white" : "black";
        if (moverColor !== this.myColor) {
          this.notify(`Соперник сыграл: ${sans[i]}${clockSuffix}`);
        }
      }
    }
    this.appliedMoveCount = uciMoves.length;

    if (this.myColor) {
      const opponentColor: Color = this.myColor === "white" ? "black" : "white";
      const opponentDrawFlag: boolean = Boolean(opponentColor === "white" ? state.wdraw : state.bdraw);
      if (opponentDrawFlag && !this.opponentOfferedDraw) {
        this.notify("🤝 Соперник предлагает ничью. Напишите /draw, чтобы принять, или /nodraw, чтобы отклонить.");
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
      mate: "мат",
      resign: "сдача",
      stalemate: "пат",
      timeout: "тайм-аут соперника",
      draw: "ничья",
      outoftime: "закончилось время",
      cheat: "аннулирована",
      noStart: "не началась",
      aborted: "прервана",
      variantEnd: "завершение варианта",
    };
    const statusText = statusNames[state.status] ?? state.status;

    if (!state.winner) {
      return `Игра окончена: ${statusText}.`;
    }
    const iWon = state.winner === this.myColor;
    return `Игра окончена: ${statusText}. ${iWon ? "Вы победили! 🎉" : "Вы проиграли."}`;
  }

  /** Parses and submits a user-entered move (SAN or UCI). Returns a reply string for the chat. */
  async handleUserMove(input: string): Promise<string> {
    if (!this.gameId || !this.myColor) {
      return "Нет активной партии. Начните игру на lichess — я подключусь автоматически.";
    }

    const turnColor: Color = this.chess.turn() === "w" ? "white" : "black";
    if (turnColor !== this.myColor) {
      return "Сейчас не ваш ход.";
    }

    const trimmed = input.trim();
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
      return `Не удалось распознать ход "${input}". Используйте SAN (e4, Nf3, O-O) или UCI (e2e4).`;
    }

    const uci = move.from + move.to + (move.promotion ?? "");
    try {
      await makeMove(this.gameId, uci);
      const clockSuffix =
        this.whiteTimeMs !== null && this.blackTimeMs !== null
          ? ` (белые: ${formatClock(this.whiteTimeMs)}, чёрные: ${formatClock(this.blackTimeMs)})`
          : "";
      return `✅ Ход отправлен: ${move.san}${clockSuffix}`;
    } catch (err) {
      return `Lichess отклонил ход: ${(err as Error).message}`;
    }
  }

  async resign(): Promise<string> {
    if (!this.gameId) {
      return "Нет активной партии.";
    }
    try {
      await resignGame(this.gameId);
      return "Вы сдались.";
    } catch (err) {
      return `Не удалось сдаться: ${(err as Error).message}`;
    }
  }

  /** Offers a draw, or accepts one already offered by the opponent. */
  async offerDraw(): Promise<string> {
    if (!this.gameId) {
      return "Нет активной партии.";
    }
    try {
      await offerOrAcceptDraw(this.gameId);
      return this.opponentOfferedDraw ? "Ничья принята." : "Предложение ничьей отправлено.";
    } catch (err) {
      return `Не удалось отправить предложение ничьей: ${(err as Error).message}`;
    }
  }

  async declineDraw(): Promise<string> {
    if (!this.gameId) {
      return "Нет активной партии.";
    }
    try {
      await declineDraw(this.gameId);
      return "Предложение ничьей отклонено.";
    } catch (err) {
      return `Не удалось отклонить ничью: ${(err as Error).message}`;
    }
  }

  getStatus(): string {
    if (!this.gameId || !this.myColor) {
      return "Нет активной партии. Начните игру на lichess.org — я подключусь автоматически.";
    }
    const turnColor: Color = this.chess.turn() === "w" ? "white" : "black";
    const isMyTurn = turnColor === this.myColor;
    const clockLine =
      this.whiteTimeMs !== null && this.blackTimeMs !== null
        ? `Часы: белые ${formatClock(this.whiteTimeMs)} — чёрные ${formatClock(this.blackTimeMs)}\n`
        : "";
    return (
      `Партия: https://lichess.org/${this.gameId}\n` +
      `Вы играете: ${this.myColor === "white" ? "белыми" : "чёрными"}\n` +
      `Ход: ${isMyTurn ? "ваш" : "соперника"}\n` +
      clockLine +
      `FEN: ${this.chess.fen()}`
    );
  }
}
