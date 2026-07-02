// ゲーム全体で使う「型（かた）」の辞書。
// 採点まわりの型は scoring.ts が持つので、ここから再輸出して窓口を一本化する。
import type { Choice, Ranking, Payout, PayoutKind } from "./scoring";
export type { Choice, Ranking, Payout, PayoutKind } from "./scoring";

/** プレイヤーの識別子（名前ではなく文字列ID。将来クラウド化でも移行しやすい） */
export type PlayerId = string;

/** お題のジャンル（価値観の軸。実物カード取り込み時に整える） */
export type Genre = "food" | "love" | "money" | "life" | "dilemma" | "daily" | "other";

/** お題のトーン（軽い/中くらい） */
export type Tone = "light" | "mid";

/** お題の出どころ（公式カード由来 / 追加＝心理テスト等から自作） */
export type TopicSource = "official" | "custom";

/** お題1問（選択肢は7つ前提。検証は別途） */
export interface Topic {
  id: string;
  q: string;
  opts: string[];
  genre?: Genre;
  tone?: Tone;
  source?: TopicSource; // 未指定は official 扱い
}

/** プレイヤー1人（このゲーム1回ぶんの参加者。idは下のProfileのidを使う） */
export interface Player {
  id: PlayerId;
  name: string;
}

/**
 * 端末に保存される人物プロファイル（「席」ではなく「その人自身」）。
 * 過去回答・分析はこの永続IDに紐づく。Player.id にこの id を渡すことで、
 * 何回遊んでも同じ人として履歴を積み上げられる。
 */
export interface Profile {
  id: PlayerId; // crypto.randomUUID() による安定ID
  name: string;
  isDefault?: boolean; // ⭐常連。true ならゲーム開始時に自動で参加メンバーに入る
}

/** 画面の状態（進行状態とは分離する） */
export type Phase =
  | "setup" // 準備
  | "gate" // 発走（レース開始演出・音楽）
  | "intro" // 出題者紹介（音声。クリックでお題へ）
  | "answer" // 出題者が本音で着順を決める
  | "handoff" // 端末を次の予想者へ渡す（目隠し）
  | "guess" // 予想者が着順を予想
  | "reveal" // このラウンドの結果発表
  | "final"; // 最終結果

/** 予想者1人ぶんの結果（reveal表示・将来のログ用） */
export interface GuessEntry {
  guesserId: PlayerId;
  guess: Ranking;
  payout: Payout;
}

/** 1ラウンドの結果（reveal表示用の実行時データ） */
export interface RoundReveal {
  topicId: string;
  askerId: PlayerId;
  answer: Ranking;
  entries: GuessEntry[];
}

/** 永続用：予想者1人ぶんの結果（Payoutまるごとでなく、必要な分だけ薄く保存） */
export interface SavedGuess {
  guesserId: PlayerId;
  guess: Ranking;
  payoutKey: PayoutKind; // 役の種類（sanrentan等）
  pt: number; // 獲得点
}

/**
 * 永続用：1レース（1お題）の結果。振り返りログの最小単位。
 * 集計（ジャンル別一致率など）はこの配列を後から読んで計算する。
 */
export interface RoundResult {
  topicId: string;
  askerId: PlayerId;
  answer: Ranking; // 出題者の着順
  guesses: SavedGuess[]; // 各予想者の結果
  genre?: Genre;
  tone?: Tone;
  playedAt: number; // 保存時刻（Date.now()）
}

/** ゲーム全体の状態。phase（画面）と進行データ（roundIndex等）を別フィールドに保つ */
export interface GameState {
  phase: Phase;
  players: Player[];
  deck: Topic[]; // 出題順（length = totalRounds）
  maxLaps: number; // 周回数（2-4人=2 / 5-6人=1。任意で増やせる）
  totalRounds: number; // = players.length * maxLaps
  roundIndex: number; // 0-based の出題ターン番号
  scores: Record<PlayerId, number>; // プレイヤーID → 得点

  // ---- 現在ラウンドの作業データ ----
  answer: Choice[]; // 出題者の選択中（0〜3）
  answerLocked: boolean; // 端末を渡したら true（以後修正不可）
  guesserQueue: PlayerId[]; // まだ予想していない人（先頭が次の番）
  currentGuesserId: PlayerId | null; // いま予想している人
  guess: Choice[]; // 現在の予想者の選択中（0〜3）
  reveal: RoundReveal | null; // reveal表示用（集計済み）
  results: RoundResult[]; // このゲームで確定したレース結果（発見カードの計算元）
}
