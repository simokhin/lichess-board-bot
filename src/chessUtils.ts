import { Chess, type Move } from "chess.js";

export type Color = "white" | "black";

export function applyUci(chess: Chess, uci: string): Move {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci.slice(4, 5) : undefined;
  return chess.move({ from, to, promotion });
}

const UCI_RE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i;

/** Accepts "0-0"/"0-0-0" (digit zero) as aliases for the SAN "O-O"/"O-O-O" castling notation. */
export function normalizeCastling(input: string): string {
  const trimmed = input.trim();
  const queenside = /^(?:o-o-o|0-0-0)([+#])?$/i.exec(trimmed);
  if (queenside) return `O-O-O${queenside[1] ?? ""}`;
  const kingside = /^(?:o-o|0-0)([+#])?$/i.exec(trimmed);
  if (kingside) return `O-O${kingside[1] ?? ""}`;
  return trimmed;
}

/** Parses a SAN or UCI move against the given position. Returns null if the move can't be
 * parsed or is illegal; never mutates any shared state. */
export function parseMoveInput(fen: string, input: string): Move | null {
  const trimmed = normalizeCastling(input);
  const chess = new Chess(fen);
  try {
    return chess.move(trimmed);
  } catch {
    const uciMatch = UCI_RE.exec(trimmed);
    if (!uciMatch) return null;
    try {
      return chess.move({ from: uciMatch[1], to: uciMatch[2], promotion: uciMatch[3] });
    } catch {
      return null;
    }
  }
}

/** Replays a list of UCI moves from the starting position, returning the resulting board and SAN history. */
export function replayMoves(uciMoves: string[]): { chess: Chess; sans: string[] } {
  const chess = new Chess();
  const sans: string[] = [];
  for (const uci of uciMoves) {
    const move = applyUci(chess, uci);
    sans.push(move.san);
  }
  return { chess, sans };
}

// Unicode names these "WHITE CHESS ..." (♔♕♖♗♘♙, outline) and "BLACK CHESS ..." (♚♛♜♝♞♟,
// filled), but Telegram's font renders that pairing visually backwards — the "white" codepoints
// show up filled/dark and the "black" ones show up outlined/light. Swapped here to match what
// actually displays in the app, since that's what matters for reading the board at a glance.
const PIECE_UNICODE: Record<string, string> = {
  wp: "♟", wn: "♞", wb: "♝", wr: "♜", wq: "♛", wk: "♚",
  bp: "♙", bn: "♘", bb: "♗", br: "♖", bq: "♕", bk: "♔",
};

/** Renders the board as a monospace diagram, oriented so the given color sits at the bottom. */
export function renderBoard(chess: Chess, orientation: Color): string {
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
