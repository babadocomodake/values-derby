import { describe, it, expect } from "vitest";
import { scoreRound, type Ranking } from "./scoring";

// お題の選択肢を A〜G の記号で代用してテストする（中身は何でもよい）。
const A = "A", B = "B", C = "C", X = "X", Y = "Y", Z = "Z";

// テーブル駆動テスト: [説明, answer, guess, 期待するkey, 期待する点数]
const cases: [string, Ranking, Ranking, string, number][] = [
  // --- 6役の正常系 ---
  ["サンレンタン: 選択肢も順位も完全一致", [A, B, C], [A, B, C], "sanrentan", 6],
  ["サンレンプク: 3つ一致だが順位違い", [A, B, C], [C, A, B], "sanrenpuku", 4],
  ["ニレンタン: 1位2位が順番通り(3位は外れ)", [A, B, C], [A, B, X], "nirentan", 3],
  ["プクプク: 選択肢2つ一致・順位は違う", [A, B, C], [B, A, X], "puku2", 2],
  ["タン: 1位の選択肢と順位だけ当たった(単勝)", [A, B, C], [A, X, Y], "tan", 1],
  ["ハズレ: 一致なし", [A, B, C], [X, Y, Z], "miss", 0],

  // --- タンは「1位限定」（公式準拠）。2位/3位だけ当たっても0点 ---
  ["2位だけ順位一致は0点(タンは1位限定)", [A, B, C], [X, B, Y], "miss", 0],
  ["3位だけ順位一致は0点(タンは1位限定)", [A, B, C], [X, Y, C], "miss", 0],

  // --- 境界・優先順位の確認 ---
  // 1位だけ一致(exact=1)だが、2つ含む(setMatch=2)場合はタンでなくプクプク(高い役優先)
  ["優先: setMatch=2 はタンよりプクプク", [A, B, C], [A, C, X], "puku2", 2],
  // 1位2位が順番通り(nirentan)だが setMatch=3 のときはサンレンプクが優先
  ["優先: setMatch=3 はニレンタンよりサンレンプク", [A, B, C], [A, C, B], "sanrenpuku", 4],

  // --- 重複入力(本来UIで防ぐ。現在の挙動を固定して記録) ---
  // guess に A が重複: exact=1(先頭A), setMatch=2(A,B含む) → プクプク扱い
  ["重複guess[A,A,B]の現挙動: プクプク", [A, B, C], [A, A, B], "puku2", 2],
];

describe("scoreRound（公式仕様・変更しない）", () => {
  it.each(cases)("%s", (_desc, answer, guess, expectedKey, expectedPt) => {
    const r = scoreRound(answer, guess);
    expect(r.key).toBe(expectedKey);
    expect(r.pt).toBe(expectedPt);
  });
});
