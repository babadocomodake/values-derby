import { describe, it, expect, beforeEach } from "vitest";
import {
  loadAnswered,
  markAnswered,
  clearAnswered,
  loadResults,
  appendResult,
  clearResults,
} from "./storage";
import type { RoundResult } from "./types";

// 回答済みお題の記録（出題者=人 単位の除外。案B）の検証。
// jsdom が localStorage を提供するので、毎テスト前にまっさらにする。
describe("回答済みお題の記録（人単位 / storage）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("初期状態は空マップ", () => {
    expect(loadAnswered()).toEqual({});
  });

  it("人ごとに分けて記録される", () => {
    markAnswered("A", "t1");
    markAnswered("A", "t2");
    markAnswered("B", "t1");
    const map = loadAnswered();
    expect(new Set(map["A"])).toEqual(new Set(["t1", "t2"]));
    expect(new Set(map["B"])).toEqual(new Set(["t1"]));
  });

  it("同じ人に同じお題を重ねても増えない（和集合）", () => {
    markAnswered("A", "t1");
    markAnswered("A", "t1");
    expect(loadAnswered()["A"]).toEqual(["t1"]);
  });

  it("リセットで全員ぶん空に戻る", () => {
    markAnswered("A", "t1");
    markAnswered("B", "t2");
    clearAnswered();
    expect(loadAnswered()).toEqual({});
  });

  it("壊れたJSONは空マップにフォールバック（落ちない）", () => {
    localStorage.setItem("vd:v1:answered", "{壊れた");
    expect(loadAnswered()).toEqual({});
  });

  it("schemaVersion不一致は空マップにフォールバック", () => {
    localStorage.setItem(
      "vd:v1:answered",
      JSON.stringify({ schemaVersion: 999, byProfile: { A: ["t1"] } }),
    );
    expect(loadAnswered()).toEqual({});
  });

  it("byProfileの型が壊れていても空マップにフォールバック", () => {
    localStorage.setItem(
      "vd:v1:answered",
      JSON.stringify({ schemaVersion: 1, byProfile: { A: "not-an-array" } }),
    );
    expect(loadAnswered()).toEqual({});
  });
});

// 振り返りログ（1レース1件の結果を積み上げる）の検証。
describe("振り返りログ（結果保存 / storage）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // テスト用の最小ダミー結果
  const sample = (overrides: Partial<RoundResult> = {}): RoundResult => ({
    topicId: "t1",
    askerId: "A",
    answer: ["x", "y", "z"],
    guesses: [{ guesserId: "B", guess: ["x", "z", "y"], payoutKey: "tan", pt: 1 }],
    genre: "food",
    tone: "light",
    playedAt: 1000,
    ...overrides,
  });

  it("初期状態は空配列", () => {
    expect(loadResults()).toEqual([]);
  });

  it("追記した順（古い→新しい）で返る", () => {
    appendResult(sample({ topicId: "t1", playedAt: 1 }));
    appendResult(sample({ topicId: "t2", playedAt: 2 }));
    const r = loadResults();
    expect(r.map((x) => x.topicId)).toEqual(["t1", "t2"]);
  });

  it("保存した中身が読み戻せる", () => {
    appendResult(sample());
    const r = loadResults()[0];
    expect(r.askerId).toBe("A");
    expect(r.answer).toEqual(["x", "y", "z"]);
    expect(r.guesses[0]).toMatchObject({ guesserId: "B", payoutKey: "tan", pt: 1 });
    expect(r.genre).toBe("food");
  });

  it("直前と同じ出題者×お題は二重保存しない（StrictMode対策）", () => {
    appendResult(sample({ topicId: "t1", askerId: "A", playedAt: 1 }));
    appendResult(sample({ topicId: "t1", askerId: "A", playedAt: 2 })); // 同じ→弾く
    expect(loadResults()).toHaveLength(1);
    appendResult(sample({ topicId: "t1", askerId: "B", playedAt: 3 })); // 出題者違い→入る
    expect(loadResults()).toHaveLength(2);
  });

  it("リセットで空に戻る", () => {
    appendResult(sample());
    clearResults();
    expect(loadResults()).toEqual([]);
  });

  it("壊れたJSONは空配列にフォールバック", () => {
    localStorage.setItem("vd:v1:results", "{壊れた");
    expect(loadResults()).toEqual([]);
  });

  it("schemaVersion不一致は空配列にフォールバック", () => {
    localStorage.setItem(
      "vd:v1:results",
      JSON.stringify({ schemaVersion: 999, results: [sample()] }),
    );
    expect(loadResults()).toEqual([]);
  });

  it("壊れた1件だけ捨て、健全な分は残す", () => {
    localStorage.setItem(
      "vd:v1:results",
      JSON.stringify({
        schemaVersion: 1,
        results: [
          sample({ topicId: "ok" }),
          { topicId: "broken" }, // answer/guesses 欠落の壊れた1件
        ],
      }),
    );
    const r = loadResults();
    expect(r.map((x) => x.topicId)).toEqual(["ok"]);
  });
});
