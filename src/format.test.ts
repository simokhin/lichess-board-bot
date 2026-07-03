import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeMd, formatClock } from "./format.js";

test("formatClock", async (t) => {
  await t.test("formats sub-minute durations", () => {
    assert.equal(formatClock(0), "0:00");
    assert.equal(formatClock(5000), "0:05");
  });

  await t.test("formats minutes and seconds", () => {
    assert.equal(formatClock(65_000), "1:05");
    assert.equal(formatClock(599_000), "9:59");
  });

  await t.test("formats hours once the clock reaches 60 minutes", () => {
    assert.equal(formatClock(3_600_000), "1:00:00");
    assert.equal(formatClock(3_661_000), "1:01:01");
  });

  await t.test("clamps negative durations to zero", () => {
    assert.equal(formatClock(-5000), "0:00");
  });

  await t.test("rounds to the nearest second", () => {
    assert.equal(formatClock(1_499), "0:01");
    assert.equal(formatClock(1_501), "0:02");
  });
});

test("escapeMd", async (t) => {
  await t.test("leaves plain text untouched", () => {
    assert.equal(escapeMd("hello world"), "hello world");
  });

  await t.test("escapes underscores, asterisks, backticks, and open brackets", () => {
    assert.equal(escapeMd("under_score"), "under\\_score");
    assert.equal(escapeMd("a*b`c[d"), "a\\*b\\`c\\[d");
  });

  await t.test("escapes every occurrence, not just the first", () => {
    assert.equal(escapeMd("a_b_c"), "a\\_b\\_c");
  });

  await t.test("does not escape characters outside the legacy Markdown special set", () => {
    assert.equal(escapeMd("close ] paren ) dash - dot ."), "close ] paren ) dash - dot .");
  });
});
