// localStorage を直接触る処理を“ここだけ”に集約する（汎用Repository等の抽象化はしない方針）。
// 差し替えたくなってもこの1ファイルを直せばよい、という形にしておく。
//
// 防御の方針: 各永続データに schemaVersion を持たせ、読込時は try/catch＋型ガードで検査。
// 壊れていた/版が違う場合は「空(初期値)」に倒して、絶対にアプリを落とさない。
import type { Profile, RoundResult, SavedGuess } from "./types";

const SCHEMA_VERSION = 1;
// キーは 名前空間(vd) : 版(v1) : 種類 で区切る（将来の衝突・移行に強い）
const PROFILES_KEY = "vd:v1:profiles";
const ANSWERED_KEY = "vd:v1:answered"; // プロフィール別「出題者として本音を答えたお題ID」
const RESULTS_KEY = "vd:v1:results"; // 振り返りログ（1レース1件の結果を積み上げる）

interface ProfilesFile {
  schemaVersion: number;
  profiles: Profile[];
}

// 1件が Profile の形をしているかの手書き型ガード
function isProfile(x: unknown): x is Profile {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as Profile).id === "string" &&
    typeof (x as Profile).name === "string"
  );
}

/** 保存済みの人物一覧を読む。壊れていれば空配列で復帰（フォールバック）。 */
export function loadProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as ProfilesFile;
    if (data.schemaVersion !== SCHEMA_VERSION || !Array.isArray(data.profiles)) return [];
    return data.profiles.filter(isProfile);
  } catch {
    return []; // JSON破損・容量例外など。落とさず空で続行。
  }
}

/** 人物一覧を保存する。保存失敗（プライベートモード等）は致命でないので握りつぶす。 */
export function saveProfiles(profiles: Profile[]): void {
  try {
    const data: ProfilesFile = { schemaVersion: SCHEMA_VERSION, profiles };
    localStorage.setItem(PROFILES_KEY, JSON.stringify(data));
  } catch {
    // no-op（保存できなくてもゲーム自体は続けられる）
  }
}

/** 新しい人物の安定IDを発行する。 */
export function newProfileId(): string {
  return crypto.randomUUID();
}

// ===== 回答済みお題の記録（出題者=人 単位の除外。案B）=====
// 「その人が出題者として本音を答えたお題」を人ごとに覚える。
// 同じお題でも、まだ答えていない別の人にはちゃんと出る（お題を無駄に消費しない）。

/** プロフィールID → 回答済みお題IDの配列 */
export type AnsweredMap = Record<string, string[]>;

interface AnsweredFile {
  schemaVersion: number;
  byProfile: AnsweredMap;
}

// byProfile が「文字列→文字列配列」の形をしているかの手書き型ガード
function isAnsweredMap(x: unknown): x is AnsweredMap {
  if (typeof x !== "object" || x === null) return false;
  return Object.values(x as Record<string, unknown>).every(
    (v) => Array.isArray(v) && v.every((id) => typeof id === "string"),
  );
}

/** 全員ぶんの回答済みマップを読む。壊れていれば空で復帰（フォールバック）。 */
export function loadAnswered(): AnsweredMap {
  try {
    const raw = localStorage.getItem(ANSWERED_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as AnsweredFile;
    if (data.schemaVersion !== SCHEMA_VERSION || !isAnsweredMap(data.byProfile)) return {};
    return data.byProfile;
  } catch {
    return {}; // 破損時も落とさず「回答済みゼロ」として続行
  }
}

/** ある人の回答済みお題に1件追加（既存と和集合）。 */
export function markAnswered(profileId: string, topicId: string): void {
  try {
    const map = loadAnswered();
    const set = new Set(map[profileId] ?? []);
    set.add(topicId);
    map[profileId] = [...set];
    const data: AnsweredFile = { schemaVersion: SCHEMA_VERSION, byProfile: map };
    localStorage.setItem(ANSWERED_KEY, JSON.stringify(data));
  } catch {
    // no-op（保存できなくても進行に支障はない）
  }
}

/** 回答済み履歴を全員ぶん消去（また全お題が新鮮になる）。 */
export function clearAnswered(): void {
  try {
    localStorage.removeItem(ANSWERED_KEY);
  } catch {
    // no-op
  }
}

// ===== 振り返りログ（1レースの結果を積み上げて保存）=====
// あとで「ジャンル別の一致率」「過去の自分の答え」などを計算するための生データ。
// 表示（発見カード・グラフ）は別ステップ。ここでは“貯める”だけに徹する。

interface ResultsFile {
  schemaVersion: number;
  results: RoundResult[];
}

// 長さ3・全要素が文字列の配列か（Ranking の形）
function isRanking(x: unknown): boolean {
  return Array.isArray(x) && x.length === 3 && x.every((c) => typeof c === "string");
}

// SavedGuess 1件の形チェック
function isSavedGuess(x: unknown): x is SavedGuess {
  const g = x as SavedGuess;
  return (
    typeof x === "object" &&
    x !== null &&
    typeof g.guesserId === "string" &&
    isRanking(g.guess) &&
    typeof g.payoutKey === "string" &&
    typeof g.pt === "number"
  );
}

// RoundResult 1件の形チェック（壊れた1件は読み込み時に捨てる）
function isRoundResult(x: unknown): x is RoundResult {
  const r = x as RoundResult;
  return (
    typeof x === "object" &&
    x !== null &&
    typeof r.topicId === "string" &&
    typeof r.askerId === "string" &&
    isRanking(r.answer) &&
    Array.isArray(r.guesses) &&
    r.guesses.every(isSavedGuess) &&
    typeof r.playedAt === "number"
  );
}

/** 全レース結果を新しい順ではなく保存順（古い→新しい）で返す。壊れていれば空配列で復帰。 */
export function loadResults(): RoundResult[] {
  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as ResultsFile;
    if (data.schemaVersion !== SCHEMA_VERSION || !Array.isArray(data.results)) return [];
    return data.results.filter(isRoundResult); // 壊れた1件だけ捨てて、健全な分は活かす
  } catch {
    return [];
  }
}

/** 1レースぶんの結果を末尾に追記して保存。 */
export function appendResult(result: RoundResult): void {
  try {
    const prev = loadResults();
    // 直前と同じ 出題者×お題 は二重保存（StrictModeの副作用2回実行など）とみなしスキップ。
    // 1ゲーム内で同じ出題者が同じお題を連続で答えることは無いので、これで安全に弾ける。
    const last = prev[prev.length - 1];
    if (last && last.topicId === result.topicId && last.askerId === result.askerId) return;
    const data: ResultsFile = { schemaVersion: SCHEMA_VERSION, results: [...prev, result] };
    localStorage.setItem(RESULTS_KEY, JSON.stringify(data));
  } catch {
    // no-op（保存できなくても進行に支障はない）
  }
}

/** 振り返りログを全消去。 */
export function clearResults(): void {
  try {
    localStorage.removeItem(RESULTS_KEY);
  } catch {
    // no-op
  }
}
