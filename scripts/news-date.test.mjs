import assert from "node:assert/strict";
import test from "node:test";
import { newsDateLabel } from "../src/news-date.ts";

test("news dates distinguish the same month and day in different years", () => {
  const oldDate = newsDateLabel(Date.parse("2025-10-23T12:00:00+08:00"));
  const newDate = newsDateLabel(Date.parse("2026-10-23T12:00:00+08:00"));
  assert.match(oldDate, /2025/);
  assert.match(newDate, /2026/);
  assert.notEqual(oldDate, newDate);
  for (const value of [undefined, null, NaN, Infinity, 0]) {
    assert.equal(newsDateLabel(value), "时间待补充");
  }
});
