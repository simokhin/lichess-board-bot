import { test } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { normalizeCastling, parseMoveInput, renderBoard, replayMoves } from "./chessUtils.js";

const START_FEN = new Chess().fen();
const CASTLING_FEN = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
const PROMOTION_FEN = "8/P7/8/8/8/8/8/k6K w - - 0 1";

test("normalizeCastling", async (t) => {
  await t.test("converts digit-zero castling to the SAN letter-O form", () => {
    assert.equal(normalizeCastling("0-0"), "O-O");
    assert.equal(normalizeCastling("0-0-0"), "O-O-O");
  });

  await t.test("preserves check/mate suffixes", () => {
    assert.equal(normalizeCastling("0-0+"), "O-O+");
    assert.equal(normalizeCastling("0-0-0#"), "O-O-O#");
  });

  await t.test("is case-insensitive and leaves already-correct SAN untouched", () => {
    assert.equal(normalizeCastling("o-o"), "O-O");
    assert.equal(normalizeCastling("O-O"), "O-O");
  });

  await t.test("leaves non-castling input untouched", () => {
    assert.equal(normalizeCastling("e4"), "e4");
    assert.equal(normalizeCastling("Nf3"), "Nf3");
  });
});

test("parseMoveInput", async (t) => {
  await t.test("parses SAN input", () => {
    const move = parseMoveInput(START_FEN, "e4");
    assert.ok(move);
    assert.equal(move.san, "e4");
    assert.equal(move.from, "e2");
    assert.equal(move.to, "e4");
  });

  await t.test("parses UCI input", () => {
    const move = parseMoveInput(START_FEN, "e2e4");
    assert.ok(move);
    assert.equal(move.san, "e4");
  });

  await t.test("parses digit-zero castling notation", () => {
    const move = parseMoveInput(CASTLING_FEN, "0-0");
    assert.ok(move);
    assert.equal(move.san, "O-O");
    assert.equal(move.from, "e1");
    assert.equal(move.to, "g1");
  });

  await t.test("parses promotion in both SAN and UCI form", () => {
    const sanMove = parseMoveInput(PROMOTION_FEN, "a8=Q");
    assert.ok(sanMove);
    assert.equal(sanMove.san, "a8=Q+");
    assert.equal(sanMove.promotion, "q");

    const uciMove = parseMoveInput(PROMOTION_FEN, "a7a8q");
    assert.ok(uciMove);
    assert.equal(uciMove.san, "a8=Q+");
  });

  await t.test("rejects illegal moves", () => {
    assert.equal(parseMoveInput(START_FEN, "e5"), null);
  });

  await t.test("rejects unparseable garbage", () => {
    assert.equal(parseMoveInput(START_FEN, "zzzz"), null);
  });

  await t.test("does not mutate any shared position", () => {
    const fenBefore = START_FEN;
    parseMoveInput(fenBefore, "e4");
    assert.equal(fenBefore, START_FEN);
  });
});

test("replayMoves", async (t) => {
  await t.test("returns an empty history for no moves", () => {
    const { chess, sans } = replayMoves([]);
    assert.deepEqual(sans, []);
    assert.equal(chess.fen(), START_FEN);
  });

  await t.test("replays a UCI move list into SAN history and final position", () => {
    const { chess, sans } = replayMoves(["e2e4", "e7e5", "g1f3"]);
    assert.deepEqual(sans, ["e4", "e5", "Nf3"]);
    assert.equal(chess.turn(), "b");
  });
});

test("renderBoard", async (t) => {
  await t.test("orients the board with white at the bottom", () => {
    const diagram = renderBoard(new Chess(), "white");
    const lines = diagram.split("\n");
    assert.equal(lines.length, 10); // header + 8 ranks + footer
    assert.equal(lines[0], "  a b c d e f g h");
    assert.equal(lines[1], "8 ♜ ♞ ♝ ♛ ♚ ♝ ♞ ♜ 8");
    assert.equal(lines[8], "1 ♖ ♘ ♗ ♕ ♔ ♗ ♘ ♖ 1");
    assert.equal(lines[9], "  a b c d e f g h");
  });

  await t.test("flips files and ranks with black at the bottom", () => {
    const diagram = renderBoard(new Chess(), "black");
    const lines = diagram.split("\n");
    assert.equal(lines[0], "  h g f e d c b a");
    assert.equal(lines[1], "1 ♖ ♘ ♗ ♔ ♕ ♗ ♘ ♖ 1");
    assert.equal(lines[8], "8 ♜ ♞ ♝ ♚ ♛ ♝ ♞ ♜ 8");
  });

  await t.test("renders empty squares as a middle dot", () => {
    const diagram = renderBoard(new Chess(), "white");
    const lines = diagram.split("\n");
    assert.equal(lines[4], "5 · · · · · · · · 5");
  });
});
