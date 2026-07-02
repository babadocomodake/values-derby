// 音まわり（ファンファーレ＋おじさん実況）をまとめた層。
// UI(App.tsx)からは playFanfare() / announce() / toggleSound() などを呼ぶだけ。
// ※ロジック(reducer)には一切触れない。音は「演出」なので完全に独立させる。
//
// 用語:
//  - Web Audio API: ブラウザ内で音を合成/再生する仕組み。ここでオリジナルのファンファーレを作る。
//  - Web Speech API(SpeechSynthesis): ブラウザ内蔵の音声合成。参加者名も喋れるので実況に使う。
//  - AudioContext: 音を鳴らすための「土台」。最初のタップ後でないと動かない制約がある。

// ===== 音のON/OFF（localStorageに保存。既定はON）=====
const SOUND_KEY = "vd_sound_on";

export function isSoundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* 保存できなくても致命的ではない */
  }
  if (!on) stopSpeak(); // OFFにした瞬間に喋っていたら止める
}

// ===== AudioContext（遅延生成。ブラウザは初回ユーザー操作後しか鳴らせない）=====
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

// 「ダービー開始」など最初のタップで呼ぶ。音の制約を解除する。
// AudioContext を resume し、音声合成も一度空打ちして iOS の制約を外す。
export function unlockAudio(): void {
  const c = getCtx();
  if (c && c.state === "suspended") void c.resume();
  // iOS Safari は無音でも一度 speak しないと以後喋らないことがある
  try {
    const synth = window.speechSynthesis;
    if (synth) {
      const u = new SpeechSynthesisUtterance("");
      u.volume = 0;
      synth.speak(u);
    }
  } catch {
    /* 非対応ブラウザは無視 */
  }
}

// ===== オリジナル・ファンファーレ（Web Audioで合成。JRA楽曲は使わない）=====
// 目標: JRAのG1ファンファーレ(パーンパパパーン)を最上位イメージに、
//       競馬未経験者でも“競馬だ！”と感じる音。ただし実曲の複製はせずオリジナル旋律。
// 競馬を連想させる“記号”をオリジナルで再現し、複数パターンから選べるようにする:
//   ① 王道ブラス  … トランペット隊＋ホール残響＋ティンパニのG1ファンファーレ路線【本命】
//   ② 整列ラッパ  … 競馬場の出走前ラッパ(Call to the Post)風。ソロ・トランペットの合図
//   ③ レトロ8bit  … ファミコン風チップチューン

// ---- 下ごしらえ（波形・ノイズ・残響） ----

// ホワイトノイズ源（ドラム用）。
function makeNoiseSource(c: AudioContext, seconds: number): AudioBufferSourceNode {
  const rate = c.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = c.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

// パルス波(任意デューティ比)。0.5=矩形、0.25/0.125=ファミコンらしい細い音。
const pulseWaveCache = new Map<number, PeriodicWave>();
function pulseWave(c: AudioContext, duty: number): PeriodicWave {
  const cached = pulseWaveCache.get(duty);
  if (cached) return cached;
  const n = 24;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let i = 1; i < n; i++) imag[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
  const w = c.createPeriodicWave(real, imag);
  pulseWaveCache.set(duty, w);
  return w;
}

// トランペット風の波形。倍音を金管らしい配分で重ねる（生ノコギリより“ブラス”に聞こえる）。
let trumpetWaveCache: PeriodicWave | null = null;
function trumpetWave(c: AudioContext): PeriodicWave {
  if (trumpetWaveCache) return trumpetWaveCache;
  const amps = [0, 1, 0.92, 0.78, 0.62, 0.48, 0.36, 0.27, 0.2, 0.15, 0.11, 0.08, 0.06];
  const real = new Float32Array(amps.length);
  const imag = new Float32Array(amps.length);
  for (let i = 1; i < amps.length; i++) imag[i] = amps[i];
  trumpetWaveCache = c.createPeriodicWave(real, imag);
  return trumpetWaveCache;
}

// 残響（会場の反響）のインパルス応答。減衰ノイズ。
function makeImpulse(c: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = c.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = c.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

// 音名 → 周波数
const NF: Record<string, number> = {
  C2: 65.41, D2: 73.42, E2: 82.41, F2: 87.31, G2: 98.0, A2: 110.0, B2: 123.47,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, F6: 1396.91, G6: 1567.98, A6: 1760.0, B6: 1975.53,
  C7: 2093.0, D7: 2349.32,
};

// 音符 [開始(8分単位), 長さ(8分単位), 音名]
type Mel = [number, number, string];

// ---- 出力バス（master→リミッタ→出力／必要なら残響send） ----
// いま鳴っているファンファーレの master ゲイン。stopFanfare() で素早く絞って止める。
let activeMaster: GainNode | null = null;
type Bus = { master: GainNode; out: (node: AudioNode) => void };
function makeBus(c: AudioContext, reverbAmount: number): Bus {
  const master = c.createGain();
  master.gain.value = 0.8;
  activeMaster = master; // 直近の再生を“現在の曲”として覚えておく（途中で止められるように）
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -7;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  master.connect(limiter);
  limiter.connect(c.destination);

  let reverb: ConvolverNode | null = null;
  if (reverbAmount > 0) {
    reverb = c.createConvolver();
    reverb.buffer = makeImpulse(c, 1.8, 2.6);
    const rg = c.createGain();
    rg.gain.value = reverbAmount;
    reverb.connect(rg);
    rg.connect(master);
  }
  return {
    master,
    out: (node) => {
      node.connect(master);
      if (reverb) node.connect(reverb);
    },
  };
}

// ---- 楽器（すべて bus に出力） ----

// トランペット（倍音波＋フィルタ開き＋アンサンブル。ブラスの厚み）
function trumpet(c: AudioContext, bus: Bus, start: number, dur: number, freq: number, peak: number, opts: { vibrato?: boolean; bright?: boolean; voices?: number } = {}) {
  const amp = c.createGain();
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(peak, start + 0.025); // 少し丸いアタック
  amp.gain.setValueAtTime(peak, start + Math.max(0.06, dur * 0.7));
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);

  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(1100, start);
  lp.frequency.exponentialRampToValueAtTime(opts.bright ? 6500 : 4500, start + 0.05); // 金管の“開き”
  lp.frequency.exponentialRampToValueAtTime(2200, start + dur);
  lp.Q.value = 0.9;
  amp.connect(lp);
  bus.out(lp);

  const voices = opts.voices ?? 2;
  const detunes = voices >= 3 ? [-7, 0, 7] : voices === 2 ? [-5, 5] : [0];
  const wave = trumpetWave(c);
  for (const det of detunes) {
    const o = c.createOscillator();
    o.setPeriodicWave(wave);
    o.frequency.value = freq;
    o.detune.value = det;
    const g = c.createGain();
    g.gain.value = 1 / detunes.length;
    o.connect(g);
    g.connect(amp);
    if (opts.vibrato) {
      const lfo = c.createOscillator();
      lfo.frequency.value = 5.5;
      const lg = c.createGain();
      lg.gain.value = freq * 0.01;
      lfo.connect(lg);
      lg.connect(o.frequency);
      lfo.start(start + 0.2);
      lfo.stop(start + dur);
    }
    o.start(start);
    o.stop(start + dur + 0.05);
  }
}

// パルス波1音（チップ用）
function pulse(c: AudioContext, bus: Bus, start: number, dur: number, freq: number, peak: number, duty: number, vibrato = false) {
  const o = c.createOscillator();
  o.setPeriodicWave(pulseWave(c, duty));
  o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.006);
  g.gain.exponentialRampToValueAtTime(peak * 0.55, start + Math.max(0.06, dur * 0.5));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g);
  bus.out(g);
  if (vibrato) {
    const lfo = c.createOscillator();
    lfo.frequency.value = 6.5;
    const lg = c.createGain();
    lg.gain.value = freq * 0.013;
    lfo.connect(lg);
    lg.connect(o.frequency);
    lfo.start(start + 0.18);
    lfo.stop(start + dur);
  }
  o.start(start);
  o.stop(start + dur + 0.02);
}

// 三角波ベース
function tri(c: AudioContext, bus: Bus, start: number, dur: number, freq: number, peak: number) {
  const o = c.createOscillator();
  o.type = "triangle";
  o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.01);
  g.gain.setValueAtTime(peak, start + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g);
  bus.out(g);
  o.start(start);
  o.stop(start + dur + 0.02);
}

// ティンパニ（ピッチが少し落ちる太鼓）
function timpani(c: AudioContext, bus: Bus, start: number, freq: number, peak: number) {
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(freq * 1.5, start);
  o.frequency.exponentialRampToValueAtTime(freq, start + 0.08);
  const g = c.createGain();
  g.gain.setValueAtTime(peak, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
  o.connect(g);
  bus.out(g);
  o.start(start);
  o.stop(start + 0.6);
}

// キック（低音の太鼓）
function kick(c: AudioContext, bus: Bus, start: number, peak: number) {
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(150, start);
  o.frequency.exponentialRampToValueAtTime(45, start + 0.12);
  const g = c.createGain();
  g.gain.setValueAtTime(peak, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
  o.connect(g);
  bus.out(g);
  o.start(start);
  o.stop(start + 0.16);
}

// ノイズ系（スネア／シンバル。highpassしたノイズの破裂音）
function noiseHit(c: AudioContext, bus: Bus, start: number, peak: number, dur: number, hz: number) {
  const n = makeNoiseSource(c, dur);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = hz;
  const g = c.createGain();
  g.gain.setValueAtTime(peak, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  n.connect(hp);
  hp.connect(g);
  bus.out(g);
  n.start(start);
  n.stop(start + dur);
}

// コード名 → 低音ルート＋構成音3つ（アルペジオ/パッド用）
const CHORD: Record<string, { root: string; triad: string[] }> = {
  C: { root: "C3", triad: ["C4", "E4", "G4"] },
  G: { root: "G3", triad: ["G4", "B4", "D5"] },
  Am: { root: "A3", triad: ["A4", "C5", "E5"] },
  F: { root: "F3", triad: ["F4", "A4", "C5"] },
};

// ============================================================
// パターン① 王道ブラス（JRAファンファーレ路線）
// ============================================================
// ♩=120（4分=0.5秒）。JRA実曲は複製せず“調子”だけをオリジナル旋律で再現する。
// 三連符の勢い＋ホルン/トロンボーンの三連スタブ＋スネア三連＋荘厳な伸ばし。
const BRASS_BEAT = 0.5;
// 主旋律 [開始秒, 長さ秒, 音名]（トランペット。高音域で最初から最高潮）
type MelT = [number, number, string];
const T = 0.5 / 3; // 三連符1個の長さ
const BRASS_MEL_FULL: MelT[] = [
  // 掴み：低音から本編の頭(E6)へ地続きで登る助走。頂点は先取りしない。
  [0.0, 0.25, "G4"], [0.25, 0.25, "C5"], [0.5, 0.25, "E5"], [0.75, 0.25, "G5"], // 8分で登る
  [1.0, T, "G5"], [1.0 + T, T, "A5"], [1.0 + 2 * T, T, "B5"], // 三連符でひと押し
  [1.5, 0.5, "C6"], // C6でいったん着地 → 本編のE6へ自然に繋ぐ
  // 荘厳な本編へ（E6→…→C7で登り切る）
  [2.0, 0.5, "E6"],
  [2.5, T, "E6"], [2.5 + T, T, "F6"], [2.5 + 2 * T, T, "G6"],
  [3.0, 1.0, "C7"],
  [4.0, 0.75, "G6"], [4.75, 0.25, "E6"],
  [5.0, 0.5, "F6"], [5.5, 0.5, "D6"],
  [6.0, T, "C6"], [6.0 + T, T, "D6"], [6.0 + 2 * T, T, "E6"],
  [6.5, 0.5, "G6"],
  [7.0, 1.0, "D6"],
  [8.0, 0.5, "G6"],
  [8.5, T, "E6"], [8.5 + T, T, "G6"], [8.5 + 2 * T, T, "B6"],
  [9.0, 0.5, "B6"], [9.5, 0.5, "G6"],
  [10.0, 2.0, "C7"], // 頂点：高音C7を長く保持
];
const BRASS_FULL_LEN = 12.0;
// コード区間 [開始秒, コード名, 伴奏スタイル("sus"=伸ばし / "trip"=三連スタブ)]
// 冒頭2秒は sus にして「パーン パパパパーン」を前に出す。以降は三連スタブで疾走。
const BRASS_PROG_FULL: [number, string, "sus" | "trip"][] = [
  [0.0, "C", "sus"],
  [2.0, "C", "trip"], [3.0, "C", "trip"], [4.0, "C", "trip"],
  [5.0, "F", "trip"], [6.0, "C", "trip"], [7.0, "G", "trip"], [8.0, "C", "trip"], [9.0, "G", "trip"],
  [10.0, "C", "sus"],
];
const BRASS_MEL_SHORT: MelT[] = [
  [0.0, 0.25, "G4"], [0.25, 0.25, "C5"], [0.5, 0.25, "E5"], [0.75, 0.25, "G5"], // 助走
  [1.0, T, "G5"], [1.0 + T, T, "A5"], [1.0 + 2 * T, T, "B5"], // ひと押し
  [1.5, 0.25, "C6"], [1.75, 1.25, "C7"], // C6→頂点C7を保持
];
const BRASS_SHORT_LEN = 3.0;
const BRASS_PROG_SHORT: [number, string, "sus" | "trip"][] = [
  [0.0, "C", "sus"],
];

function playBrass(c: AudioContext, t0: number, grand: boolean) {
  const bus = makeBus(c, 0.5);
  const mel = grand ? BRASS_MEL_FULL : BRASS_MEL_SHORT;
  const prog = grand ? BRASS_PROG_FULL : BRASS_PROG_SHORT;
  const end = grand ? BRASS_FULL_LEN : BRASS_SHORT_LEN;
  const beat = BRASS_BEAT;

  // 主旋律（トランペット3声。伸ばし音はビブラート）
  for (const [tt, dur, name] of mel) {
    trumpet(c, bus, t0 + tt, dur * 0.94, NF[name], 0.22, { bright: true, voices: 3, vibrato: dur >= 0.9 });
  }

  // 伴奏：区間ごとに sus(伸ばし和音) / trip(三連スタブ＋スネア三連＋キック)
  for (let si = 0; si < prog.length; si++) {
    const [t, cn, style] = prog[si];
    const segEnd = si + 1 < prog.length ? prog[si + 1][0] : end;
    const ch = CHORD[cn];
    if (style === "sus") {
      for (const n of ch.triad) trumpet(c, bus, t0 + t, (segEnd - t) * 0.98, NF[n] / 2, 0.05, { voices: 1 });
      for (let bt = t; bt + 1e-6 < segEnd; bt += beat) tri(c, bus, t0 + bt, beat * 0.9, NF[ch.root] / 2, 0.2);
      timpani(c, bus, t0 + t, NF[ch.root] / 2, 0.5);
    } else {
      for (let bt = t; bt + 1e-6 < segEnd; bt += beat) {
        for (let k = 0; k < 3; k++) {
          const st = bt + k * (beat / 3);
          for (const n of ch.triad) trumpet(c, bus, t0 + st, (beat / 3) * 0.72, NF[n] / 2, 0.05, { voices: 1 });
          noiseHit(c, bus, t0 + st, 0.1, 0.08, 1800); // スネア三連
        }
        tri(c, bus, t0 + bt, beat * 0.9, NF[ch.root] / 2, 0.2); // チューバ/低音
        kick(c, bus, t0 + bt, 0.45);
      }
    }
  }

  // 開幕から最高潮：頭に大クラッシュ＋最低音ティンパニ
  noiseHit(c, bus, t0, 0.18, 1.3, 3200);
  if (grand) timpani(c, bus, t0, NF["C2"], 0.7);

  // フィナーレ：全域Cメジャーの大和音＋長いクラッシュ＋最低音ティンパニ
  const lastT = prog[prog.length - 1][0];
  for (const n of ["C4", "E4", "G4", "C5", "E5", "G5", "C6"]) {
    trumpet(c, bus, t0 + lastT, (end - lastT) * 1.0, NF[n], 0.05, { bright: true, voices: 1, vibrato: true });
  }
  noiseHit(c, bus, t0 + lastT, 0.2, 1.6, 3400);
  timpani(c, bus, t0 + lastT, NF["C2"], 0.7);
}

// ============================================================
// パターン② 整列ラッパ（Call to the Post 風のソロ・トランペット）
// 三和音の音(ド・ミ・ソ)だけで吹く＝ラッパの“出走の合図”らしさ
// ============================================================
const BUGLE_E = 0.16;
const BUGLE_FULL: Mel[] = [
  [0, 1, "G4"], [1, 1, "C5"], [2, 1, "E5"], [3, 1, "C5"], [4, 1, "G4"], [5, 1, "C5"], [6, 2, "E5"],
  [8, 1, "G4"], [9, 1, "C5"], [10, 1, "E5"], [11, 1, "G5"], [12, 3, "E5"],
  [16, 1, "C5"], [17, 1, "E5"], [18, 1, "G5"], [19, 1, "E5"], [20, 1, "C5"], [21, 1, "E5"], [22, 2, "G5"],
  [24, 1, "E5"], [25, 1, "G5"], [26, 1, "C6"], [27, 1, "G5"], [28, 4, "C6"],
];
const BUGLE_SHORT: Mel[] = [
  [0, 1, "G4"], [1, 1, "C5"], [2, 1, "E5"], [3, 1, "G5"], [4, 1, "E5"], [5, 1, "G5"], [6, 4, "C6"],
];

function playBugle(c: AudioContext, t0: number, grand: boolean) {
  const bus = makeBus(c, 0.35);
  const mel = grand ? BUGLE_FULL : BUGLE_SHORT;
  for (const [i, len, name] of mel) {
    trumpet(c, bus, t0 + i * BUGLE_E, Math.max(0.1, len * BUGLE_E * 0.9), NF[name], 0.24, {
      bright: true,
      voices: 1,
      vibrato: len >= 4,
    });
  }
}

// ============================================================
// パターン③ レトロ8bit（チップチューン）
// ============================================================
const CHIP_E = 0.17;
const CHIP_HOOK: Mel[] = [
  [0, 1, "G4"], [1, 1, "C5"], [2, 1, "E5"], [3, 1, "G5"], [4, 2, "E5"], [6, 1, "D5"], [7, 1, "C5"],
  [8, 2, "D5"], [10, 1, "G5"], [11, 1, "B5"], [12, 2, "A5"], [14, 2, "G5"],
  [16, 2, "C6"], [18, 1, "B5"], [19, 1, "A5"], [20, 2, "G5"], [22, 1, "E5"], [23, 1, "A5"],
  [24, 2, "A5"], [26, 1, "G5"], [27, 1, "F5"], [28, 2, "E5"], [30, 1, "F5"], [31, 1, "G5"],
];
const CHIP_BRIDGE: Mel[] = [
  [32, 1, "G5"], [33, 1, "A5"], [34, 1, "B5"], [35, 1, "C6"], [36, 1, "D6"], [37, 1, "E6"], [38, 2, "D6"],
  [40, 1, "B5"], [41, 1, "D6"], [42, 2, "G6"], [44, 1, "E6"], [45, 1, "D6"], [46, 2, "B5"],
];
const CHIP_CLIMAX: Mel[] = [
  [48, 4, "C6"], [52, 1, "E6"], [53, 1, "D6"], [54, 2, "C6"], [56, 8, "C6"],
];
const CHIP_FULL: Mel[] = [...CHIP_HOOK, ...CHIP_BRIDGE, ...CHIP_CLIMAX];
const CHIP_FULL_CH = ["C", "G", "Am", "F", "G", "G", "C", "C"];
const CHIP_SHORT: Mel[] = [
  [0, 1, "G4"], [1, 1, "C5"], [2, 1, "E5"], [3, 1, "G5"], [4, 1, "C6"], [5, 1, "E6"], [6, 2, "G5"],
  [8, 8, "C6"],
];
const CHIP_SHORT_CH = ["C", "C"];

function playChip(c: AudioContext, t0: number, grand: boolean) {
  const bus = makeBus(c, 0); // レトロはドライ
  const mel = grand ? CHIP_FULL : CHIP_SHORT;
  const chords = grand ? CHIP_FULL_CH : CHIP_SHORT_CH;
  const bar = 8 * CHIP_E;
  const climaxBar = grand ? 6 : 0;
  for (const [i, len, name] of mel) {
    pulse(c, bus, t0 + i * CHIP_E, Math.max(0.1, len * CHIP_E * 0.92), NF[name], 0.24, 0.25, len >= 4);
  }
  for (let b = 0; b < chords.length; b++) {
    const ch = CHORD[chords[b]];
    const bt = t0 + b * bar;
    // アルペジオ（構成音を50msずつ回す）
    const notes = ch.triad.map((n) => NF[n]);
    let idx = 0;
    for (let t = bt; t < bt + bar; t += 0.05, idx++) {
      pulse(c, bus, t, Math.min(0.06, bt + bar - t), notes[idx % notes.length], 0.06, 0.125);
    }
    tri(c, bus, bt, 4 * CHIP_E * 0.92, NF[ch.root], 0.22);
    tri(c, bus, bt + 4 * CHIP_E, 4 * CHIP_E * 0.92, NF[ch.root], 0.22);
    kick(c, bus, bt, 0.5);
    kick(c, bus, bt + 4 * CHIP_E, 0.5);
    noiseHit(c, bus, bt + 2 * CHIP_E, 0.16, 0.12, 1500);
    noiseHit(c, bus, bt + 6 * CHIP_E, 0.16, 0.12, 1500);
  }
  if (grand) {
    for (let k = 0; k < 8; k++) noiseHit(c, bus, t0 + (climaxBar - 1) * bar + k * CHIP_E, 0.05 + k * 0.02, 0.07, 2500);
  }
  noiseHit(c, bus, t0 + climaxBar * bar, 0.16, 1.0, 4000);
}

// ============================================================
// レジストリ・選択・再生
// ============================================================
export type FanfareId = "brass" | "bugle" | "chip";

type FanfareDef = {
  id: FanfareId;
  label: string;
  desc: string;
  play: (c: AudioContext, t0: number, grand: boolean) => void;
  fullMs: number;
  shortMs: number;
};

// 長さ(ms)＝小節数×1小節＋余韻。ラッパは小節概念が薄いので音符終端から算出。
const melEndMs = (mel: Mel[], e: number, tail = 0.3) =>
  Math.round((Math.max(...mel.map(([i, len]) => i + len)) * e + tail) * 1000);

export const FANFARES: FanfareDef[] = [
  {
    id: "brass",
    label: "王道ブラス",
    desc: "JRAのG1ファンファーレ路線。トランペット隊＋残響＋ティンパニ",
    play: playBrass,
    fullMs: BRASS_FULL_LEN * 1000 + 300,
    shortMs: BRASS_SHORT_LEN * 1000 + 300,
  },
  {
    id: "bugle",
    label: "整列ラッパ",
    desc: "競馬場の出走前ラッパ風。ソロ・トランペットの合図",
    play: playBugle,
    fullMs: melEndMs(BUGLE_FULL, BUGLE_E),
    shortMs: melEndMs(BUGLE_SHORT, BUGLE_E),
  },
  {
    id: "chip",
    label: "レトロ8bit",
    desc: "ファミコン風チップチューン",
    play: playChip,
    fullMs: CHIP_FULL_CH.length * 8 * CHIP_E * 1000 + 300,
    shortMs: CHIP_SHORT_CH.length * 8 * CHIP_E * 1000 + 300,
  },
];

const FANFARE_KEY = "vd_fanfare_id";
const DEFAULT_FANFARE: FanfareId = "brass";

export function getFanfareId(): FanfareId {
  try {
    const v = localStorage.getItem(FANFARE_KEY) as FanfareId | null;
    if (v && FANFARES.some((f) => f.id === v)) return v;
  } catch {
    /* 無視 */
  }
  return DEFAULT_FANFARE;
}

export function setFanfareId(id: FanfareId): void {
  try {
    localStorage.setItem(FANFARE_KEY, id);
  } catch {
    /* 無視 */
  }
}

function defOf(id: FanfareId): FanfareDef {
  return FANFARES.find((f) => f.id === id) ?? FANFARES[0];
}

// 選択中パターンの長さ（実況の待ち時間に使う）
export function fanfareMs(grand: boolean, id: FanfareId = getFanfareId()): number {
  const d = defOf(id);
  return Math.round(grand ? d.fullMs : d.shortMs);
}

// grand=true でフル版、false で短縮版。id 省略時は選択中のパターン。
export function playFanfare(grand = true, id: FanfareId = getFanfareId()): void {
  if (!isSoundOn()) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  defOf(id).play(c, c.currentTime + 0.06, grand);
}

// いま鳴っているファンファーレを素早くフェードして止める（発走→お題へ進む時など）。
// プツッと切れないよう約80msで絞る。音声合成(実況)は別系統なので影響しない。
export function stopFanfare(): void {
  if (!ctx || !activeMaster) return;
  try {
    const now = ctx.currentTime;
    const g = activeMaster.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0.0001, now + 0.08);
  } catch {
    /* 無視 */
  }
}

// 試聴（選択に関係なく指定パターンのフル版を鳴らす）。ON/OFFに関係なく鳴らす。
export function previewFanfare(id: FanfareId): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  defOf(id).play(c, c.currentTime + 0.06, true);
}

// ===== おじさん実況（Web Speech API）=====
let cachedVoice: SpeechSynthesisVoice | null | undefined; // undefined=未探索 / null=見つからず

// 日本語の男性寄りボイスを優先的に選ぶ。端末により候補が違うので順に探す。
function pickVoice(): SpeechSynthesisVoice | null {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const voices = synth.getVoices();
  if (voices.length === 0) return null;
  const ja = voices.filter((v) => v.lang?.toLowerCase().startsWith("ja"));
  if (ja.length === 0) return null;
  // オフライン(localService)の音声を優先。ネットワーク音声はChromeで無音になりやすい。
  const local = ja.filter((v) => v.localService);
  const pool = local.length > 0 ? local : ja;
  // 男性名の既知ボイスを優先（iOS/mac: Otoya, Hattori / Android: 男性音声など）
  const preferred = ["otoya", "hattori", "o-ren", "ichiro", "male"];
  for (const key of preferred) {
    const hit = pool.find((v) => v.name.toLowerCase().includes(key));
    if (hit) return hit;
  }
  return pool[0]; // 男性が無ければ日本語の先頭（Kyoko等）でも喋らせる
}

function getVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice;
  cachedVoice = pickVoice();
  return cachedVoice;
}

// ボイス一覧は非同期で埋まることがある → 変化したらキャッシュを作り直す
if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoice = pickVoice();
  };
}

export function stopSpeak(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* 無視 */
  }
}

// おじさん実況をひとこと喋る。低め・少しゆっくりで“おじさん”感を出す。
// clear=true なら喋りかけを止めてから話す（連投で重ならないように）。
export function announce(text: string, opts: { clear?: boolean } = {}): void {
  if (!isSoundOn()) return;
  const synth = window.speechSynthesis;
  if (!synth) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  const v = getVoice();
  if (v) u.voice = v;
  u.pitch = 0.85; // 低めでおじさん寄り
  u.rate = 1.02; // 実況らしく気持ち速め
  u.volume = 1;

  // ブラウザ対策：
  //  ・一時停止(paused)状態だと speak しても鳴らないことがある → resume()
  //  ・cancel() の直後に speak() すると発話が無視される既知の不具合(Chrome/Safari)
  //    があるため、clear 時は少し間を空けてから話す。
  //  ・Chromeは長め/連続の発話で途中停止するバグがある → 話す間 resume を打ち続ける。
  const fire = () => {
    try {
      synth.resume();
    } catch {
      /* 無視 */
    }
    const pump = setInterval(() => {
      try {
        synth.resume();
      } catch {
        /* 無視 */
      }
    }, 250);
    const stop = () => clearInterval(pump);
    u.addEventListener("end", stop);
    u.addEventListener("error", stop);
    setTimeout(stop, 20000); // 保険（鳴り終わり検知に失敗してもいつか止める）
    synth.speak(u);
  };
  try {
    synth.resume();
  } catch {
    /* 無視 */
  }
  if (opts.clear) {
    synth.cancel();
    setTimeout(fire, 130);
  } else {
    fire();
  }
}
