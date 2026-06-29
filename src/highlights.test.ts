import { describe, it, expect } from "vitest";
import { computeHighlights } from "./highlights";
import type { RoundResult, PayoutKind, Ranking } from "./types";

// テスト用に1レース結果を組み立てる小道具
function round(
  topicId: string,
  askerId: string,
  answer: Ranking,
  guesses: { id: string; guess: Ranking; key: PayoutKind }[],
): RoundResult {
  return {
    topicId,
    askerId,
    answer,
    guesses: guesses.map((g) => ({ guesserId: g.id, guess: g.guess, payoutKey: g.key, pt: 0 })),
    playedAt: 0,
  };
}

describe("発見カードの計算（highlights）", () => {
  it("空なら全て null", () => {
    expect(computeHighlights([])).toEqual({ pita: null, split: null, surprise: null, champ: null });
  });

  it("🎯 ピタリ賞: 最初のサンレンタンを拾う", () => {
    const rounds = [
      round("t1", "A", ["x", "y", "z"], [{ id: "B", guess: ["y", "x", "z"], key: "miss" }]),
      round("t2", "B", ["x", "y", "z"], [{ id: "C", guess: ["x", "y", "z"], key: "sanrentan" }]),
    ];
    expect(computeHighlights(rounds).pita).toEqual({ topicId: "t2", guesserId: "C" });
  });

  it("🌀 割れたお題: 予想者の1着が最も分かれたレース", () => {
    const rounds = [
      // 1着がそろっている（割れていない）
      round("t1", "A", ["x", "y", "z"], [
        { id: "B", guess: ["x", "z", "y"], key: "miss" },
        { id: "C", guess: ["x", "y", "z"], key: "miss" },
      ]),
      // 1着が3人バラバラ（最も割れた）
      round("t2", "B", ["x", "y", "z"], [
        { id: "A", guess: ["x", "y", "z"], key: "miss" },
        { id: "C", guess: ["y", "x", "z"], key: "miss" },
        { id: "D", guess: ["z", "x", "y"], key: "miss" },
      ]),
    ];
    expect(computeHighlights(rounds).split).toEqual({ topicId: "t2", distinct: 3 });
  });

  it("🌀 予想者が1人だけのレースは割れ対象にしない", () => {
    const rounds = [
      round("t1", "A", ["x", "y", "z"], [{ id: "B", guess: ["z", "y", "x"], key: "miss" }]),
    ];
    expect(computeHighlights(rounds).split).toBeNull();
  });

  it("😲 意外な答え: 出題者の1着を誰も1着に予想しなかったレース", () => {
    const rounds = [
      round("t1", "A", ["x", "y", "z"], [
        { id: "B", guess: ["y", "x", "z"], key: "miss" }, // 1着xを誰も当てず
        { id: "C", guess: ["z", "x", "y"], key: "miss" },
      ]),
    ];
    expect(computeHighlights(rounds).surprise).toEqual({ topicId: "t1", askerId: "A", choice: "x" });
  });

  it("😲 誰かが1着を当てていれば意外ではない", () => {
    const rounds = [
      round("t1", "A", ["x", "y", "z"], [{ id: "B", guess: ["x", "z", "y"], key: "tan" }]),
    ];
    expect(computeHighlights(rounds).surprise).toBeNull();
  });

  it("👑 的中王: サンレンタン回数が最多の人", () => {
    const rounds = [
      round("t1", "A", ["x", "y", "z"], [
        { id: "B", guess: ["x", "y", "z"], key: "sanrentan" },
        { id: "C", guess: ["x", "y", "z"], key: "sanrentan" },
      ]),
      round("t2", "B", ["x", "y", "z"], [{ id: "C", guess: ["x", "y", "z"], key: "sanrentan" }]),
    ];
    // C=2回, B=1回 → C
    expect(computeHighlights(rounds).champ).toEqual({ playerId: "C", count: 2 });
  });

  it("👑 サンレンタンが1度も無ければ的中王なし", () => {
    const rounds = [
      round("t1", "A", ["x", "y", "z"], [{ id: "B", guess: ["y", "x", "z"], key: "puku2" }]),
    ];
    expect(computeHighlights(rounds).champ).toBeNull();
  });
});
