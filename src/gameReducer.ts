// ゲーム進行エンジン（純粋関数）。
// 「いまの状態 + 操作(action) → 次の状態」を返すだけ。画面(App)からは切り離して単体テストで固める。
import { scoreRound } from "./scoring";
import type {
  Choice,
  GameState,
  GuessEntry,
  Player,
  PlayerId,
  Ranking,
  RoundResult,
  Topic,
} from "./types";

// ===== 公式の周回制 =====
// 2〜4人は2周（1人2回出題）/ 5〜6人は1周（1人1回）。任意で増やせる。
export function defaultMaxLaps(playerCount: number): number {
  return playerCount <= 4 ? 2 : 1;
}

// ===== セレクタ（状態から導く読み取り専用の値）=====
/** 現在ラウンドの出題者 */
export function getAsker(state: GameState): Player {
  return state.players[state.roundIndex % state.players.length];
}
/** 現在の周（1-based） */
export function getLap(state: GameState): number {
  return Math.floor(state.roundIndex / state.players.length) + 1;
}
/** 現在のお題 */
export function getCurrentTopic(state: GameState): Topic {
  return state.deck[state.roundIndex];
}

// ===== アクション定義 =====
export type Action =
  | { type: "START_GAME"; players: Player[]; deck: Topic[]; maxLaps: number }
  | { type: "VIEW_TOPIC" } // intro → answer
  | { type: "TOGGLE_ANSWER"; choice: Choice }
  | { type: "LOCK_ANSWER" } // answer → handoff（答えを確定し端末を渡す）
  | { type: "BEGIN_GUESS" } // handoff → guess（受け手が解錠）
  | { type: "TOGGLE_GUESS"; choice: Choice }
  | { type: "SUBMIT_GUESS" } // guess → handoff(次の人) or reveal(全員終了)
  | { type: "NEXT_ROUND" } // reveal → intro or final
  | { type: "RESET" }; // → setup

// 選択肢を「最大3つ・押すとトグル」で選ぶ共通処理
function toggleChoice(list: Choice[], choice: Choice): Choice[] {
  if (list.includes(choice)) return list.filter((c) => c !== choice);
  if (list.length < 3) return [...list, choice];
  return list; // すでに3つなら無視
}

// 出題者以外を、プレイヤー順に並べた予想者キューを作る
function buildGuesserQueue(players: Player[], askerId: PlayerId): PlayerId[] {
  return players.filter((p) => p.id !== askerId).map((p) => p.id);
}

/** 初期状態（準備画面） */
export function initialState(): GameState {
  return {
    phase: "setup",
    players: [],
    deck: [],
    maxLaps: 2,
    totalRounds: 0,
    roundIndex: 0,
    scores: {},
    answer: [],
    answerLocked: false,
    guesserQueue: [],
    currentGuesserId: null,
    guess: [],
    reveal: null,
    results: [],
  };
}

// ラウンド開始時に作業データをまっさらにする
function resetRoundWork(state: GameState): GameState {
  return {
    ...state,
    answer: [],
    answerLocked: false,
    guesserQueue: [],
    currentGuesserId: null,
    guess: [],
    reveal: null,
  };
}

export function gameReducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "START_GAME": {
      const { players, deck, maxLaps } = action;
      const scores: Record<PlayerId, number> = {};
      for (const p of players) scores[p.id] = 0;
      return {
        ...initialState(),
        phase: "intro",
        players,
        deck,
        maxLaps,
        totalRounds: deck.length,
        roundIndex: 0,
        scores,
      };
    }

    case "VIEW_TOPIC": {
      // 出題者だけがお題を見て本音を決める画面へ
      return { ...resetRoundWork(state), phase: "answer" };
    }

    case "TOGGLE_ANSWER": {
      if (state.answerLocked) return state; // 渡した後は変更不可
      return { ...state, answer: toggleChoice(state.answer, action.choice) };
    }

    case "LOCK_ANSWER": {
      // 答えを確定（3つ必要）→ 端末を渡す。ここで初めてロック。
      if (state.answer.length !== 3) return state;
      const askerId = getAsker(state).id;
      const queue = buildGuesserQueue(state.players, askerId);
      return {
        ...state,
        answerLocked: true,
        guesserQueue: queue,
        currentGuesserId: queue[0] ?? null,
        guess: [],
        phase: "handoff",
      };
    }

    case "BEGIN_GUESS": {
      // 受け手が自分の名前で解錠 → 予想入力へ
      if (state.currentGuesserId == null) return state;
      return { ...state, phase: "guess", guess: [] };
    }

    case "TOGGLE_GUESS": {
      return { ...state, guess: toggleChoice(state.guess, action.choice) };
    }

    case "SUBMIT_GUESS": {
      // 現在の予想者の予想を採点して記録 → 次の人 or 結果発表
      if (state.guess.length !== 3 || state.currentGuesserId == null) return state;
      if (state.answer.length !== 3) return state;

      const answer = state.answer as Ranking;
      const guess = state.guess as Ranking;
      const entry: GuessEntry = {
        guesserId: state.currentGuesserId,
        guess,
        payout: scoreRound(answer, guess),
      };

      const remaining = state.guesserQueue.filter((id) => id !== state.currentGuesserId);
      const prevEntries = state.reveal?.entries ?? [];
      const entries = [...prevEntries, entry];

      if (remaining.length > 0) {
        // 次の予想者へ（また目隠しで受け渡し）
        return {
          ...state,
          reveal: {
            topicId: getCurrentTopic(state).id,
            askerId: getAsker(state).id,
            answer,
            entries,
          },
          guesserQueue: remaining,
          currentGuesserId: remaining[0],
          guess: [],
          phase: "handoff",
        };
      }

      // 全員ぶん揃った → 得点を加算して結果発表へ
      const scores = { ...state.scores };
      for (const e of entries) scores[e.guesserId] += e.payout.pt;
      const topic = getCurrentTopic(state);
      const askerId = getAsker(state).id;
      // このレースの結果を確定値としてメモリに保存（発見カードの計算元。playedAtは保存時に付与）
      const roundResult: RoundResult = {
        topicId: topic.id,
        askerId,
        answer,
        guesses: entries.map((e) => ({
          guesserId: e.guesserId,
          guess: e.guess,
          payoutKey: e.payout.key,
          pt: e.payout.pt,
        })),
        genre: topic.genre,
        tone: topic.tone,
        playedAt: 0,
      };
      return {
        ...state,
        scores,
        reveal: {
          topicId: topic.id,
          askerId,
          answer,
          entries,
        },
        results: [...state.results, roundResult],
        guesserQueue: [],
        currentGuesserId: null,
        guess: [],
        phase: "reveal",
      };
    }

    case "NEXT_ROUND": {
      const next = state.roundIndex + 1;
      if (next >= state.totalRounds) {
        return { ...resetRoundWork(state), phase: "final" };
      }
      return { ...resetRoundWork(state), roundIndex: next, phase: "intro" };
    }

    case "RESET":
      return initialState();

    default:
      return state;
  }
}
