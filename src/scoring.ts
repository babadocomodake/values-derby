// ===== 採点ロジック（公式仕様・変更しない）=====
// この関数はゲームの「唯一の公式仕様」。先にテスト(scoring.test.ts)で縛ってある。
// 入力は「正規化済み（重複なし・長さ3）」を前提とする。重複防止は UI 側の責務。

/** 選択肢のテキスト1つ */
export type Choice = string;

/** 1〜3着の着順（長さ3を型で保証） */
export type Ranking = [Choice, Choice, Choice];

/** 役の種類（ハズレ含む） */
export type PayoutKind =
  | "sanrentan"
  | "sanrenpuku"
  | "nirentan"
  | "puku2"
  | "tan"
  | "miss";

/** 役の情報。pt は獲得点数 */
export interface Payout {
  key: PayoutKind;
  label: string;
  desc: string;
  pt: number;
  /** 表示色トークン（UIで使用）。ロジックには無関係 */
  color: string;
}

/** 当たり役の定義一覧（高い役→低い役の順）。ハズレは MISS に分離 */
export const PAYOUTS: readonly Payout[] = [
  { key: "sanrentan", label: "サンレンタン", desc: "1〜3位の選択肢も順位も完全一致", pt: 6, color: "c-amber" },
  { key: "sanrenpuku", label: "サンレンプク", desc: "1〜3位の選択肢が一致（順位違い）", pt: 4, color: "c-teal" },
  { key: "nirentan", label: "ニレンタン", desc: "1位と2位を順番通り当てる", pt: 3, color: "c-blue" },
  { key: "puku2", label: "プクプク", desc: "選択肢が2つ一致（順位不問）", pt: 2, color: "c-purple" },
  { key: "tan", label: "タン", desc: "1位の選択肢と順位だけが当たった", pt: 1, color: "c-pink" },
] as const;

export const MISS: Payout = { key: "miss", label: "ハズレ", desc: "一致なし", pt: 0, color: "c-gray" };

const byKey = (k: PayoutKind): Payout => PAYOUTS.find((p) => p.key === k)!;

/**
 * 出題者の本音(answer)に対する回答者の予想(guess)を採点する。
 * 判定は「高い役から順に」評価し、最初に当たった役を返す。
 */
export function scoreRound(answer: Ranking, guess: Ranking): Payout {
  // 着順がぴったり一致した数（位置まで合っている）
  const exactCount = answer.filter((a, i) => a === guess[i]).length;
  // 順不同で一致した選択肢の数（answer の各要素が guess に含まれるか）
  const setMatch = answer.filter((a) => guess.includes(a)).length;

  // サンレンタン: 3つとも順位一致
  if (exactCount === 3) return { ...byKey("sanrentan") };
  // サンレンプク: 3つの選択肢が一致するが順位は違う
  if (setMatch === 3) return { ...byKey("sanrenpuku") };
  // ニレンタン: 1位と2位が順番通り
  if (answer[0] === guess[0] && answer[1] === guess[1]) return { ...byKey("nirentan") };
  // プクプク: 選択肢が2つ一致
  if (setMatch === 2) return { ...byKey("puku2") };
  // タン: 1位の選択肢と順位だけが当たった（単勝＝1着的中。2位/3位だけ当たっても0点）
  if (answer[0] === guess[0]) return { ...byKey("tan") };
  return { ...MISS };
}
