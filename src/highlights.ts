// 「今日の発見」カードの計算（純粋関数）。
// 1ゲームぶんのレース結果(RoundResult[])だけを入力に、会話のネタになる瞬間を拾う。
// 画面(App)から切り離してテストで固める方針（scoring.ts と同じ考え方）。
import type { RoundResult, PlayerId, Choice } from "./types";

/** 4種類の発見。該当が無いものは null（その枠は表示しない）。 */
export interface Highlights {
  /** 🎯 ピタリ賞: サンレンタン（完全一致）が出たレース */
  pita: { topicId: string; guesserId: PlayerId } | null;
  /** 🌀 いちばん割れたお題: 予想者の1着がもっともバラけたレース */
  split: { topicId: string; distinct: number } | null;
  /** 😲 意外な答え: 出題者の1着を、誰も1着に予想しなかったレース */
  surprise: { topicId: string; askerId: PlayerId; choice: Choice } | null;
  /** 👑 的中王: サンレンタンをいちばん多く出した人 */
  champ: { playerId: PlayerId; count: number } | null;
}

/**
 * 1ゲームぶんの結果から発見4枚を計算する。
 * @param rounds このゲームのレース結果（時系列）
 */
export function computeHighlights(rounds: RoundResult[]): Highlights {
  // 🎯 ピタリ賞: 最初にサンレンタンが出たレース・予想者
  let pita: Highlights["pita"] = null;
  for (const r of rounds) {
    const hit = r.guesses.find((g) => g.payoutKey === "sanrentan");
    if (hit) {
      pita = { topicId: r.topicId, guesserId: hit.guesserId };
      break;
    }
  }

  // 🌀 いちばん割れたお題: 予想者の「1着」の種類数が最大のレース
  // （予想者が2人以上いて、1着がバラけたものほど“割れた”とみなす）
  let split: Highlights["split"] = null;
  for (const r of rounds) {
    if (r.guesses.length < 2) continue; // 1人だと割れようがない
    const distinct = new Set(r.guesses.map((g) => g.guess[0])).size;
    if (distinct >= 2 && (!split || distinct > split.distinct)) {
      split = { topicId: r.topicId, distinct };
    }
  }

  // 😲 意外な答え: 出題者の1着(answer[0])を、どの予想者も1着に挙げなかったレース
  let surprise: Highlights["surprise"] = null;
  for (const r of rounds) {
    if (r.guesses.length === 0) continue;
    const top = r.answer[0];
    const anyoneGuessedTop = r.guesses.some((g) => g.guess[0] === top);
    if (!anyoneGuessedTop) {
      surprise = { topicId: r.topicId, askerId: r.askerId, choice: top };
      break;
    }
  }

  // 👑 的中王: サンレンタン回数が最多の人（1回以上。同数は先に出た人）
  const pitaCount = new Map<PlayerId, number>();
  for (const r of rounds) {
    for (const g of r.guesses) {
      if (g.payoutKey === "sanrentan") {
        pitaCount.set(g.guesserId, (pitaCount.get(g.guesserId) ?? 0) + 1);
      }
    }
  }
  let champ: Highlights["champ"] = null;
  for (const [playerId, count] of pitaCount) {
    if (!champ || count > champ.count) champ = { playerId, count };
  }

  return { pita, split, surprise, champ };
}
