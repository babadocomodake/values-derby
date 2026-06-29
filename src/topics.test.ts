import { describe, it, expect } from "vitest";
import {
  OFFICIAL_TOPICS,
  EXTRA_TOPICS,
  ALL_TOPICS,
  getTopicPool,
  validateTopics,
} from "./topics";
import type { Topic } from "./types";

describe("お題バンクの健全性（設計ガイド§7）", () => {
  it("公式お題は検証を全て通る", () => {
    expect(validateTopics(OFFICIAL_TOPICS)).toEqual([]);
  });
  it("追加お題は検証を全て通る", () => {
    expect(validateTopics(EXTRA_TOPICS)).toEqual([]);
  });
  it("全体でID重複がない（公式＋追加を混ぜても安全）", () => {
    expect(validateTopics(ALL_TOPICS)).toEqual([]);
  });
});

describe("getTopicPool（公式/追加/混合の出し分け）", () => {
  it("official は公式のみ", () => {
    expect(getTopicPool("official")).toBe(OFFICIAL_TOPICS);
  });
  it("extra は追加のみ", () => {
    expect(getTopicPool("extra")).toBe(EXTRA_TOPICS);
  });
  it("mix は公式＋追加の合計数", () => {
    expect(getTopicPool("mix")).toHaveLength(OFFICIAL_TOPICS.length + EXTRA_TOPICS.length);
  });
});

describe("validateTopics（不正を確実に弾く）", () => {
  it("選択肢が7個でないと弾く", () => {
    const bad: Topic[] = [{ id: "x1", q: "?", opts: ["a", "b", "c"] }];
    expect(validateTopics(bad).some((e) => e.includes("選択肢"))).toBe(true);
  });
  it("ID重複を弾く", () => {
    const opts = ["a", "b", "c", "d", "e", "f", "g"];
    const bad: Topic[] = [
      { id: "dup", q: "?", opts },
      { id: "dup", q: "?", opts },
    ];
    expect(validateTopics(bad).some((e) => e.includes("重複"))).toBe(true);
  });
  it("選択肢の重複を弾く", () => {
    const bad: Topic[] = [{ id: "x2", q: "?", opts: ["a", "a", "b", "c", "d", "e", "f"] }];
    expect(validateTopics(bad).some((e) => e.includes("選択肢に重複"))).toBe(true);
  });
});
