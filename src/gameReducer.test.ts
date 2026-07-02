import { describe, it, expect } from "vitest";
import {
  gameReducer,
  initialState,
  defaultMaxLaps,
  getAsker,
  getLap,
  type Action,
} from "./gameReducer";
import type { GameState, Player, Topic } from "./types";

// --- テスト用の小道具 ---
const OPTS = ["A", "B", "C", "D", "E", "F", "G"];
const makePlayers = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
const makeDeck = (n: number): Topic[] =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, q: "?", opts: OPTS }));

// 連続でアクションを適用するヘルパー
const run = (state: GameState, actions: Action[]): GameState =>
  actions.reduce(gameReducer, state);

const start = (playerCount: number, deckLen: number): GameState =>
  gameReducer(initialState(), {
    type: "START_GAME",
    players: makePlayers(playerCount),
    deck: makeDeck(deckLen),
    maxLaps: defaultMaxLaps(playerCount),
  });

describe("defaultMaxLaps（公式の周回制）", () => {
  it("2〜4人は2周", () => {
    expect(defaultMaxLaps(2)).toBe(2);
    expect(defaultMaxLaps(4)).toBe(2);
  });
  it("5〜6人は1周", () => {
    expect(defaultMaxLaps(5)).toBe(1);
    expect(defaultMaxLaps(6)).toBe(1);
  });
});

describe("START_GAME", () => {
  it("得点0・phase gate（発走）・出題者は先頭プレイヤー", () => {
    const s = start(2, 4);
    expect(s.phase).toBe("gate");
    expect(s.totalRounds).toBe(4);
    expect(s.scores).toEqual({ p1: 0, p2: 0 });
    expect(getAsker(s).id).toBe("p1");
    expect(getLap(s)).toBe(1);
  });
});

describe("2人で1ラウンド（サンレンタン）", () => {
  it("予想者に6点・出題者は0点、次ラウンドで出題者交代", () => {
    let s = start(2, 4);
    s = run(s, [
      { type: "VIEW_TOPIC" },
      { type: "TOGGLE_ANSWER", choice: "A" },
      { type: "TOGGLE_ANSWER", choice: "B" },
      { type: "TOGGLE_ANSWER", choice: "C" },
      { type: "LOCK_ANSWER" },
      { type: "BEGIN_GUESS" },
      { type: "TOGGLE_GUESS", choice: "A" },
      { type: "TOGGLE_GUESS", choice: "B" },
      { type: "TOGGLE_GUESS", choice: "C" },
      { type: "SUBMIT_GUESS" },
    ]);
    expect(s.phase).toBe("reveal");
    expect(s.reveal?.entries).toHaveLength(1);
    expect(s.reveal?.entries[0].payout.key).toBe("sanrentan");
    expect(s.scores).toEqual({ p1: 0, p2: 6 }); // 出題者p1は得点しない

    s = gameReducer(s, { type: "NEXT_ROUND" });
    expect(s.phase).toBe("gate");
    expect(s.roundIndex).toBe(1);
    expect(getAsker(s).id).toBe("p2"); // 出題者が交代
  });
});

describe("4人で1ラウンド（3人が各自予想）", () => {
  it("予想者ごとに独立採点、得点は全員ぶん揃ってから加算", () => {
    let s = start(4, 8);
    s = run(s, [
      { type: "VIEW_TOPIC" },
      { type: "TOGGLE_ANSWER", choice: "A" },
      { type: "TOGGLE_ANSWER", choice: "B" },
      { type: "TOGGLE_ANSWER", choice: "C" },
      { type: "LOCK_ANSWER" },
    ]);
    expect(s.guesserQueue).toEqual(["p2", "p3", "p4"]);
    expect(s.currentGuesserId).toBe("p2");

    // p2: A,B,C → サンレンタン6
    s = run(s, [
      { type: "BEGIN_GUESS" },
      { type: "TOGGLE_GUESS", choice: "A" },
      { type: "TOGGLE_GUESS", choice: "B" },
      { type: "TOGGLE_GUESS", choice: "C" },
      { type: "SUBMIT_GUESS" },
    ]);
    expect(s.phase).toBe("handoff");
    expect(s.currentGuesserId).toBe("p3");
    expect(s.scores).toEqual({ p1: 0, p2: 0, p3: 0, p4: 0 }); // まだ加算しない

    // p3: A,B,D → 1位2位一致でニレンタン3
    s = run(s, [
      { type: "BEGIN_GUESS" },
      { type: "TOGGLE_GUESS", choice: "A" },
      { type: "TOGGLE_GUESS", choice: "B" },
      { type: "TOGGLE_GUESS", choice: "D" },
      { type: "SUBMIT_GUESS" },
    ]);
    expect(s.currentGuesserId).toBe("p4");

    // p4: E,F,G → ハズレ0
    s = run(s, [
      { type: "BEGIN_GUESS" },
      { type: "TOGGLE_GUESS", choice: "E" },
      { type: "TOGGLE_GUESS", choice: "F" },
      { type: "TOGGLE_GUESS", choice: "G" },
      { type: "SUBMIT_GUESS" },
    ]);
    expect(s.phase).toBe("reveal");
    expect(s.reveal?.entries).toHaveLength(3);
    // 全員ぶん揃ったので加算（出題者p1は0）
    expect(s.scores).toEqual({ p1: 0, p2: 6, p3: 3, p4: 0 });
  });
});

describe("answerLocked", () => {
  it("ロック後はTOGGLE_ANSWERを無視する", () => {
    let s = start(2, 4);
    s = run(s, [
      { type: "VIEW_TOPIC" },
      { type: "TOGGLE_ANSWER", choice: "A" },
      { type: "TOGGLE_ANSWER", choice: "B" },
      { type: "TOGGLE_ANSWER", choice: "C" },
      { type: "LOCK_ANSWER" },
      { type: "TOGGLE_ANSWER", choice: "D" }, // 無視されるはず
    ]);
    expect(s.answer).toEqual(["A", "B", "C"]);
  });
});

describe("周回でゲーム終了", () => {
  it("totalRounds 回でfinalへ", () => {
    let s = start(2, 4); // totalRounds=4
    s = run(s, [
      { type: "NEXT_ROUND" }, // 1
      { type: "NEXT_ROUND" }, // 2
      { type: "NEXT_ROUND" }, // 3
    ]);
    expect(s.phase).toBe("gate");
    expect(s.roundIndex).toBe(3);
    s = gameReducer(s, { type: "NEXT_ROUND" }); // 4 → final
    expect(s.phase).toBe("final");
  });
});
