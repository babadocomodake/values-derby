// 画面（UI）本体。状態の更新ロジックは持たず、gameReducer に「操作(action)」を投げるだけ。
// ※ロジックは gameReducer.ts / scoring.ts が唯一の正。ここは「見た目」と「どのボタンで何を dispatch するか」に専念する。
import { useEffect, useMemo, useReducer, useState } from "react";
import {
  gameReducer,
  initialState,
  defaultMaxLaps,
  getAsker,
  getLap,
  getCurrentTopic,
} from "./gameReducer";
import type { GameState, Player, PlayerId, Profile, Topic } from "./types";
import { getTopicPool, OFFICIAL_TOPICS, EXTRA_TOPICS, ALL_TOPICS, type TopicPick } from "./topics";
import { computeHighlights } from "./highlights";
import {
  loadProfiles,
  saveProfiles,
  newProfileId,
  loadAnswered,
  markAnswered,
  clearAnswered,
  appendResult,
} from "./storage";
import {
  unlockAudio,
  playFanfare,
  announce,
  isSoundOn,
  setSoundOn,
  fanfareMs,
  FANFARES,
  getFanfareId,
  setFanfareId,
  previewFanfare,
  type FanfareId,
} from "./sound";

// 配列をシャッフル（お題の出題順をランダムにする）。Fisher–Yates 法。
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// プレイヤーID → 表示名（見つからなければIDをそのまま）
function nameOf(state: GameState, id: PlayerId | null): string {
  if (id == null) return "";
  return state.players.find((p) => p.id === id)?.name ?? id;
}

// ===== 小さな共通パーツ =====

// 選択肢ボタン（押すと選択トグル。選んだら「N着」を表示）
function OptionButton({
  opt,
  picked,
  rank,
  onClick,
  disabled,
}: {
  opt: string;
  picked: boolean;
  rank: number;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled && !picked}
      className={[
        // items-start＋gap で、長い選択肢が複数行に折り返しても着順バッジが右上に収まる
        "pixel-btn mb-3 flex w-full items-start justify-between gap-2 px-4 py-3 text-left text-base",
        picked ? "bg-[#ffe89a] font-bold text-[#123d17]" : "bg-[#fffdf3] text-[#123d17]",
        disabled && !picked ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
    >
      <span className="flex-1 leading-snug break-words">{opt}</span>
      {picked && <span className="mt-0.5 shrink-0 whitespace-nowrap text-sm font-medium">{rank}着 🏇</span>}
    </button>
  );
}

// 大きな主要ボタン
function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        "pixel-btn pixel-btn-gold w-full px-6 py-3 text-lg font-bold tracking-wide",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// 手番インジケータ（全phase上部に固定表示）。誰が出題者か・周回・進捗を常に見せる。
function TurnBar({ state }: { state: GameState }) {
  if (state.phase === "setup" || state.phase === "final") return null;
  const asker = getAsker(state);
  const lap = getLap(state);
  return (
    <div className="led-board mb-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span>
        第{lap}周 / 第{state.roundIndex + 1}R（全{state.totalRounds}）
      </span>
      <span className="opacity-50">|</span>
      <span>
        出題者: <span className="led-hi font-bold">{asker.name}</span>
      </span>
      {state.guesserQueue.length > 0 && state.currentGuesserId && (
        <>
          <span className="opacity-50">|</span>
          <span>
            予想中: <span className="led-hi font-bold">{nameOf(state, state.currentGuesserId)}</span>
            （残り{state.guesserQueue.length}人）
          </span>
        </>
      )}
    </div>
  );
}

// 音のON/OFFトグル（全画面の右上に固定表示）。localStorageに保存。
function SoundToggle() {
  const [on, setOn] = useState(isSoundOn());
  return (
    <button
      onClick={() => {
        const next = !on;
        setSoundOn(next);
        setOn(next);
      }}
      className="pixel-btn fixed right-3 top-3 z-50 bg-[#fffdf3] px-3 py-1.5 text-sm"
      aria-label={on ? "音を消す" : "音を出す"}
      title={on ? "音: ON（タップでOFF）" : "音: OFF（タップでON）"}
    >
      {on ? "🔊" : "🔇"}
    </button>
  );
}

// ファンファーレ選択（試聴して選ぶ）。選択は localStorage に保存。
function FanfarePicker() {
  const [sel, setSel] = useState<FanfareId>(() => getFanfareId());
  return (
    <div className="mb-4 pixel-card p-5">
      <label className="mb-1 block text-sm font-bold text-[#123d17]">ファンファーレ（開始の音）🎺</label>
      <p className="mb-3 text-xs text-[#4a6b4f]">▶で試聴して、好きなものを選んでください。</p>
      <div className="flex flex-col gap-2">
        {FANFARES.map((f) => (
          <div
            key={f.id}
            className={[
              "pixel-tab flex items-center gap-2 px-3 py-2",
              sel === f.id ? "is-active" : "",
            ].join(" ")}
          >
            <button
              onClick={() => {
                unlockAudio(); // タップで音を解禁
                previewFanfare(f.id);
              }}
              className="pixel-btn pixel-btn-gold flex h-10 w-10 shrink-0 items-center justify-center text-lg"
              aria-label={`${f.label}を試聴`}
              title="試聴する"
            >
              ▶
            </button>
            <button
              onClick={() => {
                setFanfareId(f.id);
                setSel(f.id);
              }}
              className="flex-1 text-left"
            >
              <div className="text-sm font-bold text-[#123d17]">
                {f.label} {sel === f.id && <span className="text-[#8a5a00]">✓ 選択中</span>}
              </div>
              <div className="mt-0.5 text-[11px] leading-tight text-[#4a6b4f]">{f.desc}</div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// 画面の外枠（中央寄せ＋余白）
function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-4">
      <SoundToggle />
      {children}
    </div>
  );
}

// 出題プールの選択肢（ラベルと件数つき）
const TOPIC_PICKS: { key: TopicPick; label: string; desc: string; count: number }[] = [
  { key: "official", label: "公式のみ", desc: "定番カード", count: OFFICIAL_TOPICS.length },
  { key: "extra", label: "追加のみ", desc: "追加コンテンツ", count: EXTRA_TOPICS.length },
  { key: "mix", label: "混ぜてランダム", desc: "公式＋追加", count: OFFICIAL_TOPICS.length + EXTRA_TOPICS.length },
];

// ===== セットアップ画面（コンポーネント外の state を持つので独立関数に切り出す）=====
function SetupScreen({
  onStart,
}: {
  onStart: (players: Player[], laps: number, pick: TopicPick, replay: boolean) => void;
}) {
  // 端末に登録された全人物の名簿（永続）。常に画面に出す“呼び出し元”。
  const [roster, setRoster] = useState<Profile[]>(() => {
    const loaded = loadProfiles();
    if (loaded.length > 0) return loaded;
    // 初回は空なので、初期メンバー2人を用意（保存はゲーム開始時または編集時）
    return [
      { id: newProfileId(), name: "プレイヤー1" },
      { id: newProfileId(), name: "プレイヤー2" },
    ];
  });
  // このゲームに参加する人のID（並び順＝出題順）。⭐常連がいればそれを既定に。
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const loaded = loadProfiles();
    const base = loaded.length > 0 ? loaded : []; // roster と同じ判定
    const defaults = base.filter((p) => p.isDefault).map((p) => p.id);
    if (defaults.length >= 2) return defaults;
    return base.slice(0, 2).map((p) => p.id);
  });
  const [laps, setLaps] = useState<number>(defaultMaxLaps(2));
  const [rosterOpen, setRosterOpen] = useState(false); // 名簿パネルの開閉
  const [topicPick, setTopicPick] = useState<TopicPick>("mix"); // 出題プール（公式/追加/混合）
  const [answered, setAnswered] = useState<Record<string, string[]>>(() => loadAnswered()); // 人別の回答済み
  const [replay, setReplay] = useState(false); // 再挑戦モード（回答済みも使う）

  // selectedIds が空（初回の新規2人）の場合は roster 先頭2人を既定参加に
  const playingIds = selectedIds.length >= 2 ? selectedIds : roster.slice(0, 2).map((p) => p.id);
  const playing = playingIds.map((id) => roster.find((p) => p.id === id)).filter((p): p is Profile => !!p);
  const bench = roster.filter((p) => !playingIds.includes(p.id)); // 参加していない＝名簿で待機中

  const count = playingIds.length;
  const pool = getTopicPool(topicPick); // 選んだプールの全お題
  // 参加者ごとの「まだ自分が答えていない数」（その人にとっての新鮮さ）
  const freshByPlayer = playing.map((p) => {
    const ans = new Set(answered[p.id] ?? []);
    return { name: p.name, fresh: pool.filter((t) => !ans.has(t.id)).length };
  });
  const minFresh = freshByPlayer.length ? Math.min(...freshByPlayer.map((f) => f.fresh)) : pool.length;
  const deckMax = Math.floor(pool.length / Math.max(count, 1)); // 1ゲームで重複なく配れる周回数
  // 上限：再挑戦ONなら全体、OFFなら「一番余裕のない人」と「重複なし」の小さい方
  const maxLapsByTopics = Math.max(1, replay ? deckMax : Math.min(minFresh, deckMax));
  const lapsClamped = Math.min(laps, maxLapsByTopics);
  const totalRounds = count * lapsClamped;
  const hasAnswered = Object.values(answered).some((a) => a.length > 0); // 履歴の有無
  const shortOfFresh = !replay && minFresh < lapsClamped; // 誰かは既答からの再出題になる

  const nameById = (id: string) => roster.find((p) => p.id === id)?.name ?? "";

  // 名簿を更新して即保存（呼び出し元を1つに）
  function commitRoster(next: Profile[]) {
    setRoster(next);
    saveProfiles(next);
  }

  function editName(id: string, v: string) {
    commitRoster(roster.map((p) => (p.id === id ? { ...p, name: v } : p)));
  }
  function toggleDefault(id: string) {
    commitRoster(roster.map((p) => (p.id === id ? { ...p, isDefault: !p.isDefault } : p)));
  }
  function addNew() {
    const p: Profile = { id: newProfileId(), name: `プレイヤー${roster.length + 1}` };
    commitRoster([...roster, p]);
    if (count < 6) setSelectedIds([...playingIds, p.id]);
  }
  function deleteProfile(id: string) {
    commitRoster(roster.filter((p) => p.id !== id));
    setSelectedIds(playingIds.filter((x) => x !== id));
  }
  function addToGame(id: string) {
    if (count >= 6 || playingIds.includes(id)) return;
    setSelectedIds([...playingIds, id]);
  }
  function removeFromGame(id: string) {
    if (count <= 2) return;
    setSelectedIds(playingIds.filter((x) => x !== id));
  }
  function shuffleOrder() {
    setSelectedIds(shuffle(playingIds));
  }

  function handleStart() {
    unlockAudio(); // 最初のタップで音の制約を解除（以後ファンファーレ/実況が鳴る）
    const cleaned = roster.map((p) => ({ ...p, name: p.name.trim() || "名無し" }));
    saveProfiles(cleaned);
    const players: Player[] = playingIds.map((id) => {
      const p = cleaned.find((x) => x.id === id)!;
      return { id: p.id, name: p.name };
    });
    onStart(players, lapsClamped, topicPick, replay);
  }

  // 回答済み履歴をリセット（全員ぶん。また全お題が新鮮になる）
  function resetAnswered() {
    clearAnswered();
    setAnswered({});
    setReplay(false);
  }

  const namesOk = playingIds.every((id) => nameById(id).trim().length > 0);
  const canStart = namesOk && count >= 2 && count <= 6 && totalRounds >= 1;

  return (
    <Screen>
      <div className="mb-6 text-center">
        <div className="text-6xl">🏇</div>
        <h1 className="pixel-title my-2 text-3xl font-bold tracking-wide">価値観ダービー</h1>
        <p className="inline-block bg-[#0e1a0e] px-2 py-1 text-xs text-[#ffd93b]">相手の回答を予想して、1〜3着をぴったり当てろ</p>
      </div>

      <div className="mb-4 pixel-card p-5">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-bold text-[#123d17]">参加メンバー（{count}人 / 2〜6人）</label>
          {count >= 2 && (
            <button
              onClick={shuffleOrder}
              className="pixel-btn-sm bg-[#fffdf3] px-3 py-1 text-sm"
            >
              🔀 順番ランダム
            </button>
          )}
        </div>
        <p className="mb-3 text-xs text-[#4a6b4f]">番号＝出題順（先頭が最初の出題者）。⭐常連は次回も自動で参加。</p>

        {/* 参加中の人だけコンパクトに表示 */}
        {playing.map((p, i) => (
          <div key={p.id} className="mb-2 flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center border-2 border-[#123d17] bg-[#47b14e] text-sm font-bold text-white">
              {i + 1}
            </span>
            <input
              value={p.name}
              onChange={(e) => editName(p.id, e.target.value)}
              placeholder="名前"
              className="pixel-input w-full px-3 py-2"
            />
            <button
              onClick={() => toggleDefault(p.id)}
              className={[
                "pixel-btn-sm px-3 py-2",
                p.isDefault ? "bg-[#ffe89a]" : "bg-[#fffdf3] text-[#9bb59f]",
              ].join(" ")}
              aria-label="常連（毎回自動参加）に設定"
              title="⭐常連にすると毎回自動で参加します"
            >
              {p.isDefault ? "⭐" : "☆"}
            </button>
            <button
              onClick={() => removeFromGame(p.id)}
              disabled={count <= 2}
              className="pixel-btn-sm bg-[#fffdf3] px-3 py-2 text-[#123d17] disabled:opacity-30"
              aria-label="この回から外す"
              title="この回から外す（名簿には残る）"
            >
              ✕
            </button>
          </div>
        ))}

        {/* 名簿（普段は閉じている。開いて呼び出す/追加する） */}
        <button
          onClick={() => setRosterOpen((v) => !v)}
          className="pixel-btn-sm mt-2 flex w-full items-center justify-between bg-[#eef3ea] px-3 py-2 text-sm text-[#123d17]"
        >
          <span>👥 名簿から呼び出す / 追加{bench.length > 0 ? `（待機 ${bench.length}人）` : ""}</span>
          <span>{rosterOpen ? "▲" : "▼"}</span>
        </button>

        {rosterOpen && (
          <div className="mt-2 border-[3px] border-[#123d17] p-3">
            {bench.length > 0 ? (
              <div className="mb-2 flex flex-col gap-2">
                {bench.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <button
                      onClick={() => addToGame(p.id)}
                      disabled={count >= 6}
                      className="pixel-btn-sm flex-1 bg-[#fffdf3] px-3 py-2 text-left text-sm disabled:opacity-40"
                    >
                      ＋ {p.name || "名無し"} {p.isDefault ? "⭐" : ""}
                    </button>
                    <button
                      onClick={() => deleteProfile(p.id)}
                      className="pixel-btn-sm bg-[#fffdf3] px-3 py-2 text-[#123d17]"
                      aria-label="名簿から削除"
                      title="名簿から削除"
                    >
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mb-2 text-xs text-[#4a6b4f]">待機中の人はいません。下のボタンで新しい人を追加できます。</p>
            )}
            <button
              onClick={addNew}
              disabled={count >= 6}
              className="pixel-btn-sm w-full bg-[#fffdf3] px-3 py-2 text-sm text-[#123d17] disabled:opacity-40"
            >
              ＋ 新しい人を追加
            </button>
          </div>
        )}
      </div>

      <div className="mb-4 pixel-card p-5">
        <label className="mb-2 block text-sm font-bold text-[#123d17]">お題の種類</label>
        <div className="grid grid-cols-3 gap-2">
          {TOPIC_PICKS.map((tp) => (
            <button
              key={tp.key}
              onClick={() => setTopicPick(tp.key)}
              className={[
                "pixel-tab px-2 py-3 text-center",
                topicPick === tp.key ? "is-active" : "",
              ].join(" ")}
            >
              <div className="text-sm font-bold text-[#123d17]">{tp.label}</div>
              <div className="mt-0.5 text-[11px] leading-tight text-[#4a6b4f]">{tp.desc}</div>
              <div className="mt-1 text-[11px] font-bold text-[#123d17]">{tp.count}問</div>
            </button>
          ))}
        </div>

        {/* 未回答の状況（人ごと）＋再挑戦トグル＋履歴リセット */}
        <div className="mt-3 border-t-2 border-dashed border-[#123d17]/30 pt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-[#123d17]">
            <span>各メンバーの未回答（全{pool.length}問中）</span>
            {hasAnswered && (
              <button
                onClick={resetAnswered}
                className="pixel-btn-sm bg-[#fffdf3] px-2 py-1"
              >
                履歴をリセット
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {freshByPlayer.map((f) => (
              <span
                key={f.name}
                className={[
                  "pixel-chip px-2 py-1 text-xs",
                  f.fresh === 0 ? "bg-[#ffd6a3] text-[#7a3d00]" : "bg-[#eef3ea] text-[#123d17]",
                ].join(" ")}
              >
                {f.name} <span className="font-bold">{f.fresh}</span>
              </span>
            ))}
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-[#123d17]">
            <input type="checkbox" checked={replay} onChange={(e) => setReplay(e.target.checked)} className="h-4 w-4 accent-[#d99a00]" />
            回答済みのお題を含める
          </label>
          {shortOfFresh && (
            <p className="pixel-chip mt-2 bg-[#fff3d6] px-3 py-2 text-[11px] leading-relaxed text-[#7a3d00]">
              未回答が少ない人がいるため、その人には回答済みも一部出ます。「回答済みのお題を含める」か「履歴をリセット」もどうぞ。
            </p>
          )}
        </div>
      </div>

      <div className="mb-4 pixel-card p-5">
        <label className="mb-2 block text-sm font-bold text-[#123d17]">
          周回数（1人が出題する回数）: <span className="text-[#8a5a00]">{lapsClamped}周</span>
        </label>
        <input
          type="range"
          min={1}
          max={maxLapsByTopics}
          step={1}
          value={lapsClamped}
          onChange={(e) => setLaps(Number(e.target.value))}
          className="pixel-range"
        />
        <div className="mt-1 text-xs text-[#4a6b4f]">
          全{totalRounds}レース（公式: 2〜4人=2周 / 5〜6人=1周）
        </div>
      </div>

      <FanfarePicker />

      <PrimaryButton onClick={handleStart} disabled={!canStart}>
        ダービー開始 🏁
      </PrimaryButton>
    </Screen>
  );
}

// 直前のゲーム設定（最終画面の「もう一度する」で同じ顔ぶれ・条件を使い回すため）
type GameConfig = { players: Player[]; laps: number; pick: TopicPick; replay: boolean };

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, undefined, initialState);
  const [lastConfig, setLastConfig] = useState<GameConfig | null>(null); // 直前の設定（再戦用）

  // レース開始(intro)の合図：オリジナル・ファンファーレ → 少し置いておじさん実況。
  // レースが変わるたび（phase=intro に入るたび）に1回鳴らす。
  useEffect(() => {
    if (state.phase !== "intro") return;
    const grand = state.roundIndex === 0; // 1レース目だけフル版、以降は短縮版
    playFanfare(grand);
    const askerName = getAsker(state).name;
    const raceNo = state.roundIndex + 1;
    const id = setTimeout(
      () => announce(`さぁ、第${raceNo}レース！　出題者は${askerName}さんだ！`, { clear: true }),
      fanfareMs(grand), // 選択中パターンの長さぶん待ってから喋る（被り防止）
    );
    return () => clearTimeout(id);
  }, [state.phase, state.roundIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // セットアップ完了 → 出題者スロットごとに「その人が未回答のお題」を割り当てて START_GAME。
  // ラウンド r の出題者 = players[r % 人数]（gameReducter の getAsker と一致）。
  // 各スロットで「その出題者が答えていない × このデッキで未使用」から選ぶ。
  // 足りなければ段階的に条件を緩めて、必ず need 枚そろえる（ゲームは止めない）。
  function startGame(players: Player[], laps: number, pick: TopicPick, replay: boolean) {
    setLastConfig({ players, laps, pick, replay }); // 再戦用に設定を保存
    const pool = getTopicPool(pick);
    const answered = loadAnswered();
    const n = players.length;
    const need = n * laps;
    const usedInDeck = new Set<string>();
    const deck: Topic[] = [];

    for (let r = 0; r < need; r++) {
      const askerId = players[r % n].id;
      const ans = new Set(replay ? [] : (answered[askerId] ?? []));
      // 第1希望: その人が未回答 かつ デッキ内で未使用
      let cands = pool.filter((t) => !ans.has(t.id) && !usedInDeck.has(t.id));
      // 緩和1: 回答済みも許可（デッキ内重複だけは避ける）
      if (cands.length === 0) cands = pool.filter((t) => !usedInDeck.has(t.id));
      // 緩和2: プール自体が尽きた → 何でも可（デッキ内重複も許可）
      if (cands.length === 0) cands = pool;
      deck.push(cands[Math.floor(Math.random() * cands.length)]);
      usedInDeck.add(deck[r].id);
    }

    dispatch({ type: "START_GAME", players, deck, maxLaps: laps });
  }

  // ===== setup =====
  if (state.phase === "setup") {
    return <SetupScreen onStart={startGame} />;
  }

  const asker = getAsker(state);
  const topic = getCurrentTopic(state);

  // ===== intro（出題者の発表）=====
  if (state.phase === "intro") {
    return (
      <Screen>
        <TurnBar state={state} />
        <div className="pixel-card p-8 text-center">
          <div className="mb-2 text-4xl">🎤</div>
          <p className="mb-1 text-sm text-[#4a6b4f]">このレースの出題者は</p>
          <h1 className="pixel-title mb-6 text-2xl font-bold">{asker.name} さん</h1>
          <p className="mb-6 text-sm leading-relaxed text-[#4a6b4f]">
            お題はみんなで読んでOK。
            <br />
            ただし <span className="font-bold text-[#123d17]">{asker.name}さんの着順（答え）だけ</span> は他の人に見せないでね。
          </p>
          <PrimaryButton onClick={() => dispatch({ type: "VIEW_TOPIC" })}>回答を決める →</PrimaryButton>
        </div>
      </Screen>
    );
  }

  // ===== answer（出題者が本音で着順をつける。渡すまで何度でも変更可）=====
  if (state.phase === "answer") {
    return (
      <Screen>
        <TurnBar state={state} />
        <div className="mb-3 text-center">
          <span className="pixel-chip inline-block bg-[#ffe89a] px-3 py-1 text-xs font-bold text-[#123d17]">
            {asker.name}さんの回答 🤫（渡すまで何度でも選び直せます）
          </span>
        </div>
        <h2 className="mb-1 text-center text-lg font-bold text-[#123d17]">{topic.q}</h2>
        <p className="mb-4 text-center text-xs text-[#eafff0]">好きな順に3つ選んでください（{state.answer.length}/3）</p>
        {topic.opts.map((opt) => (
          <OptionButton
            key={opt}
            opt={opt}
            picked={state.answer.includes(opt)}
            rank={state.answer.indexOf(opt) + 1}
            onClick={() => dispatch({ type: "TOGGLE_ANSWER", choice: opt })}
            disabled={state.answer.length >= 3}
          />
        ))}
        <div className="mt-2">
          <PrimaryButton onClick={() => dispatch({ type: "LOCK_ANSWER" })} disabled={state.answer.length !== 3}>
            この着順で確定して相手に渡す 🤝
          </PrimaryButton>
        </div>
      </Screen>
    );
  }

  // ===== handoff（目隠しの受け渡し。受け手指名つき）=====
  if (state.phase === "handoff") {
    const receiver = nameOf(state, state.currentGuesserId);
    return (
      <Screen>
        <TurnBar state={state} />
        <div className="pixel-card p-10 text-center">
          <div className="mb-4 text-5xl">🙈</div>
          <h1 className="pixel-title mb-2 text-xl font-bold">画面を {receiver} さんへ</h1>
          <p className="mb-6 text-sm leading-relaxed text-[#4a6b4f]">
            出題者の着順は伏せました。
            <br />
            {receiver}さんは、下のボタンを押して予想を始めてください。
          </p>
          <PrimaryButton onClick={() => dispatch({ type: "BEGIN_GUESS" })}>
            私は {receiver} です・予想を始める
          </PrimaryButton>
        </div>
      </Screen>
    );
  }

  // ===== guess（予想者が着順を予想）=====
  if (state.phase === "guess") {
    const guesser = nameOf(state, state.currentGuesserId);
    return (
      <Screen>
        <TurnBar state={state} />
        <div className="mb-3 text-center">
          <span className="pixel-chip inline-block bg-[#cfe0ff] px-3 py-1 text-xs font-bold text-[#123d17]">{guesser}さんの予想 🔮</span>
        </div>
        <h2 className="mb-1 text-center text-lg font-bold text-[#123d17]">{topic.q}</h2>
        <p className="mb-4 text-center text-xs text-[#eafff0]">
          {asker.name}さんが選んだ順を予想（{state.guess.length}/3）
        </p>
        {topic.opts.map((opt) => (
          <OptionButton
            key={opt}
            opt={opt}
            picked={state.guess.includes(opt)}
            rank={state.guess.indexOf(opt) + 1}
            onClick={() => dispatch({ type: "TOGGLE_GUESS", choice: opt })}
            disabled={state.guess.length >= 3}
          />
        ))}
        <div className="mt-2">
          <PrimaryButton onClick={() => dispatch({ type: "SUBMIT_GUESS" })} disabled={state.guess.length !== 3}>
            この予想で確定 🏁
          </PrimaryButton>
        </div>
      </Screen>
    );
  }

  // ===== reveal（結果発表。3着→2着→1着のめくり演出＋会話導線）=====
  if (state.phase === "reveal" && state.reveal) {
    return <RevealScreen state={state} onNext={() => dispatch({ type: "NEXT_ROUND" })} />;
  }

  // ===== final（最終結果）=====
  if (state.phase === "final") {
    return (
      <FinalScreen
        state={state}
        // もう一度する: 同じ顔ぶれ・条件で再戦（回答履歴は更新済みなので新鮮なお題が配られる）
        onReplay={lastConfig ? () => startGame(lastConfig.players, lastConfig.laps, lastConfig.pick, lastConfig.replay) : undefined}
        // タイトルに戻る: 準備画面へ
        onBackToTitle={() => dispatch({ type: "RESET" })}
      />
    );
  }

  return null;
}

// 結果発表画面。出題者の本音を 3着→2着→1着 の順に1枚ずつ「めくって」見せ、
// 最後の1着を開いた瞬間に役名（サンレンタン等）と会話プロンプトを出す。
// ※めくり進行は画面だけの演出なので、ロジック(reducer)には触れずローカルstateで持つ。
function RevealScreen({ state, onNext }: { state: GameState; onNext: () => void }) {
  const reveal = state.reveal!;
  const { answer, entries } = reveal;
  const asker = getAsker(state);
  const topic = getCurrentTopic(state);
  const ranks = ["1着", "2着", "3着"];

  // reveal到達＝このレースが確定した。出題者×お題 が変わった時に1回だけ:
  //  ① この出題者にこのお題を再出題しないよう記録（回答済み）
  //  ② 振り返りログ(localStorage)に1レースぶんを追記（保存時刻を付けて）
  // ※確定値は reducer が state.results に積んでいるので、その末尾を保存するだけ。
  useEffect(() => {
    markAnswered(asker.id, topic.id);
    const last = state.results[state.results.length - 1];
    if (last) appendResult({ ...last, playedAt: Date.now() });
    // レース切替（出題者×お題が変わる）時のみ実行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asker.id, topic.id]);

  // 何着まで開いたか（0=まだ／1=3着まで／2=2着まで／3=全部）。3着(index2)から順に開く。
  const [opened, setOpened] = useState(0);
  const isOpen = (i: number) => i >= 3 - opened; // index i がもう開いているか
  const allOpen = opened >= 3;
  const nextRankLabel = ranks[3 - opened - 1]; // 次に開くのは何着か（3着→2着→1着）

  // 1着をめくり切った瞬間、おじさんが本音の1着をコール。
  useEffect(() => {
    if (allOpen) announce(`${asker.name}さんの1着は…、${answer[0]}！`, { clear: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allOpen]);

  return (
    <Screen>
      <h2 className="pixel-title mb-2 text-center text-2xl font-bold">結果発表 🏁</h2>
      <p className="mb-4 inline-block w-full bg-[#0e1a0e] px-2 py-1 text-center text-sm text-[#ffd93b]">お題: {topic.q}</p>

      {/* 出題者の本音（めくり）＝スターティングゲートを開く演出 */}
      <div className="pixel-card mb-4 p-4">
        <div className="mb-2 text-xs font-bold text-[#123d17]">🐴 {asker.name}さんの回答（ゲートイン）</div>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={[
                "pixel-chip flex items-start gap-3 px-4 py-3 transition",
                isOpen(i) ? "gate-open" : "gate-closed",
              ].join(" ")}
            >
              <span className="w-10 shrink-0 pt-0.5 text-sm font-bold">{ranks[i]}</span>
              {isOpen(i) ? (
                <span className="flex-1 break-words text-base font-bold leading-snug">{answer[i]}</span>
              ) : (
                <span className="text-base font-bold tracking-widest">？？？</span>
              )}
            </div>
          ))}
        </div>

        {!allOpen && (
          <button
            onClick={() => setOpened((v) => v + 1)}
            className="pixel-btn pixel-btn-gold mt-3 w-full px-4 py-3 text-base font-bold"
          >
            {nextRankLabel}のゲートを開く 🏇
          </button>
        )}
      </div>

      {/* 各予想者の結果（開いた着順ぶんだけ ◎○✕ を点灯。役名は全部開いてから） */}
      <div className="space-y-3">
        {entries.map((e) => (
          <div key={e.guesserId} className="pixel-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-bold text-[#123d17]">{nameOf(state, e.guesserId)} さんの予想</span>
              {allOpen ? (
                <span className="pixel-chip bg-[#ffe89a] px-2 py-1 text-sm font-bold text-[#123d17]">
                  {e.payout.label} +{e.payout.pt}点
                </span>
              ) : (
                <span className="text-xs text-[#4a6b4f]">役は1着めくりで判明</span>
              )}
            </div>
            <table className="w-full text-sm">
              <tbody>
                {[0, 1, 2].map((i) => {
                  const shown = isOpen(i);
                  const hit = answer[i] === e.guess[i];
                  const setHit = answer.includes(e.guess[i]);
                  return (
                    <tr key={i} className="border-t-2 border-dashed border-[#123d17]/20 align-top">
                      <td className="whitespace-nowrap py-1.5 pr-2 font-bold text-[#4a6b4f]">{ranks[i]}</td>
                      <td className="break-words py-1.5 pr-2 text-[#123d17]">{shown ? answer[i] : "？"}</td>
                      <td
                        className={[
                          "break-words py-1.5 font-bold",
                          !shown
                            ? "text-[#9bb59f]"
                            : hit
                              ? "text-[#1f8a3b]"
                              : setHit
                                ? "text-[#c07a00]"
                                : "text-[#9bb59f]",
                        ].join(" ")}
                      >
                        {e.guess[i]} {shown ? (hit ? "◎" : setHit ? "○" : "✕") : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <p className="mt-2 inline-block w-full bg-[#0e1a0e] px-2 py-1 text-center text-xs text-[#ffd93b]">◎ 順位ぴったり / ○ 選択肢は的中 / ✕ ハズレ</p>

      {/* 会話導線（本丸）: 全部めくれてから出題者に「なぜ1着はコレ？」を促す */}
      {allOpen && (
        <div className="pixel-card mt-4 bg-[#fff3d6] p-4 text-center">
          <div className="mb-2 text-2xl">💬</div>
          <p className="text-base font-bold leading-relaxed text-[#7a3d00]">
            予想は当たりましたか？
            <br />
            なぜその順位ですか？？
          </p>
        </div>
      )}

      {/* 現在の得点（全部めくれてから） */}
      {allOpen && <ScoreRow state={state} />}

      {allOpen && (
        <div className="mt-4">
          <PrimaryButton onClick={onNext}>
            {state.roundIndex + 1 >= state.totalRounds ? "最終結果へ 🏆" : "次のレースへ →"}
          </PrimaryButton>
        </div>
      )}
    </Screen>
  );
}

// 得点の横並び表示（reveal で使用）
function ScoreRow({ state }: { state: GameState }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {state.players.map((p) => (
        <div key={p.id} className="led-board flex-1 p-3 text-center">
          <div className="text-xs">{p.name}</div>
          <div className="led-hi text-2xl font-bold">{state.scores[p.id] ?? 0}</div>
        </div>
      ))}
    </div>
  );
}

// 発見カード1枚（絵文字＋見出し＋本文）
function DiscoveryItem({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <div className="pixel-chip flex items-start gap-3 bg-[#fffdf3] px-4 py-3">
      <span className="text-2xl leading-none">{emoji}</span>
      <div>
        <div className="text-xs font-bold text-[#c07a00]">{title}</div>
        <div className="mt-0.5 text-sm leading-snug text-[#123d17]">{body}</div>
      </div>
    </div>
  );
}

// 最終結果画面
function FinalScreen({
  state,
  onReplay,
  onBackToTitle,
}: {
  state: GameState;
  onReplay?: () => void;
  onBackToTitle: () => void;
}) {
  const ranked = useMemo(
    () =>
      [...state.players].sort((a, b) => (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0)),
    [state.players, state.scores],
  );
  const top = ranked[0];
  const topScore = state.scores[top.id] ?? 0;
  const winners = ranked.filter((p) => (state.scores[p.id] ?? 0) === topScore);
  const isTie = winners.length > 1;

  // 終了時、おじさんが着順をコール（上位から読み上げ）。画面表示と同時に1回だけ。
  useEffect(() => {
    const order = ["優勝", "2位", "3位", "4位", "5位", "6位"];
    const head = isTie
      ? `本日のダービー、結果発表！　なんと、${winners.map((p) => p.name).join("、")}さんが同点で引き分けだ！`
      : `本日のダービー、結果発表！　優勝は${top.name}さん、おめでとう！`;
    const rest = ranked
      .slice(0, 3)
      .map((p, i) => `${order[i]}、${p.name}さん、${state.scores[p.id] ?? 0}点`)
      .join("。　");
    announce(`${head}　${rest}。`, { clear: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // このゲームのレース結果は state.results に確定値が入っている（保存履歴に依存しない）。
  // それを使って「レース振り返り」を計算する。
  const highlights = useMemo(() => computeHighlights(state.results), [state.results]);
  const qOf = (topicId: string) => ALL_TOPICS.find((t) => t.id === topicId)?.q ?? "（お題不明）";
  const nameOfId = (id: PlayerId) => state.players.find((p) => p.id === id)?.name ?? id;
  const hasAnyHighlight =
    !!highlights.pita || !!highlights.split || !!highlights.surprise || !!highlights.champ;

  return (
    <Screen>
      <div className="mb-4 pixel-card p-8 text-center">
        <div className="mb-2 text-6xl">🏆</div>
        <p className="mb-1 text-sm text-[#4a6b4f]">{isTie ? "結果は…" : "優勝は"}</p>
        <h1 className="pixel-title mb-6 text-3xl font-bold">
          {isTie ? "引き分け！" : `${top.name} さん！`}
        </h1>
        <div className="space-y-2">
          {ranked.map((p, i) => {
            const isWinner = (state.scores[p.id] ?? 0) === topScore;
            return (
              <div
                key={p.id}
                className={[
                  "pixel-chip flex items-center justify-between px-4 py-3",
                  isWinner ? "bg-[#ffe89a]" : "bg-[#eef3ea]",
                ].join(" ")}
              >
                <span className="font-bold text-[#123d17]">
                  {i + 1}位　{p.name}
                </span>
                <span className={["text-xl font-bold", isWinner ? "text-[#8a5a00]" : "text-[#4a6b4f]"].join(" ")}>
                  {state.scores[p.id] ?? 0}点
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* レース振り返り（勝敗より“へぇ”を主役に。該当が無い枠は出さない） */}
      {hasAnyHighlight && (
        <div className="pixel-card mb-4 bg-[#fff3d6] p-5">
          <h2 className="mb-3 text-center text-lg font-bold text-[#7a3d00]">レース振り返り 🏁</h2>
          <div className="space-y-3">
            {highlights.pita && (
              <DiscoveryItem
                emoji="🎯"
                title="ピタリ賞（サンレンタン）"
                body={`「${qOf(highlights.pita.topicId)}」で ${nameOfId(highlights.pita.guesserId)} さんが完全的中！`}
              />
            )}
            {highlights.surprise && (
              <DiscoveryItem
                emoji="😲"
                title="意外だった答え"
                body={`${nameOfId(highlights.surprise.askerId)} さんの1着「${highlights.surprise.choice}」（誰も1着に予想しなかった）`}
              />
            )}
            {highlights.split && (
              <DiscoveryItem
                emoji="🌀"
                title="いちばん割れたお題"
                body={`「${qOf(highlights.split.topicId)}」→ 予想がバラバラだった`}
              />
            )}
            {highlights.champ && (
              <DiscoveryItem
                emoji="👑"
                title="今日の的中王"
                body={`${nameOfId(highlights.champ.playerId)} さん（ピタリ ${highlights.champ.count}回）`}
              />
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {onReplay && <PrimaryButton onClick={onReplay}>もう一度する 🔄（同じメンバー）</PrimaryButton>}
        <button
          onClick={onBackToTitle}
          className="pixel-btn w-full bg-[#fffdf3] px-6 py-3 text-base font-bold text-[#123d17]"
        >
          タイトルに戻る 🏠
        </button>
      </div>
    </Screen>
  );
}
