import { getData } from './store';

// Gemini Live: a real-time voice conversation over one WebSocket.
// Mic audio goes up as 16 kHz PCM, the model's voice comes back as 24 kHz PCM, with transcripts both ways.

const API = 'https://generativelanguage.googleapis.com/v1beta';
const WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const IN_RATE = 16000;
const OUT_RATE = 24000;
const SETUP_TIMEOUT_MS = 10000;
const CHUNK_SAMPLES = 1600; // 100 ms of mic audio per message

// Known Live models, most likely to work on a free key first (the 3.8 family used to hang on free keys)
const PREFERRED = ['gemini-3.1-flash-live', 'gemini-2.5-flash-native-audio', 'gemini-3.8-live'];
const WORKED_KEY = 'liveModel'; // the model that connected last time goes first

function workedModel() {
  try {
    return localStorage.getItem(WORKED_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberModel(model: string) {
  try {
    localStorage.setItem(WORKED_KEY, model);
  } catch {
    // just tried in the default order next time
  }
}

/** Live-capable models this key can use, in the order worth trying. */
export async function liveModels(key: string): Promise<string[]> {
  let names: string[] = [];
  try {
    const r = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
    const j = await r.json();
    names = (j.models ?? [])
      .filter((m: { name: string; supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('bidiGenerateContent'))
      .map((m: { name: string }) => m.name.replace(/^models\//, ''))
      .filter((n: string) => /live|native-audio/.test(n) && !/translate|transcribe/.test(n));
  } catch {
    // listing failed: fall back to the known names
  }
  if (!names.length) names = ['gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-preview-12-2025', 'gemini-3.8-live'];
  const worked = workedModel();
  const rank = (n: string) => {
    if (n === worked) return -1;
    const i = PREFERRED.findIndex((p) => n.startsWith(p));
    return i < 0 ? PREFERRED.length : i;
  };
  return names.sort((a, b) => rank(a) - rank(b));
}

// Downsamples the mic to 16 kHz with linear interpolation and posts 100 ms Int16 chunks
const WORKLET = `
class MicTo16k extends AudioWorkletProcessor {
  constructor() { super(); this.t = 0; this.last = 0; this.out = []; this.step = sampleRate / ${IN_RATE}; }
  process(inputs) {
    const x = inputs[0] && inputs[0][0];
    if (!x) return true;
    const n = x.length;
    while (this.t < n) {
      const i = Math.floor(this.t), f = this.t - i;
      const a = i === 0 ? this.last : x[i - 1], b = x[i];
      this.out.push(a + (b - a) * f);
      this.t += this.step;
    }
    this.t -= n;
    this.last = x[n - 1];
    if (this.out.length >= ${CHUNK_SAMPLES}) {
      const pcm = new Int16Array(this.out.length);
      for (let k = 0; k < this.out.length; k++) pcm[k] = Math.max(-1, Math.min(1, this.out[k])) * 0x7fff;
      this.out = [];
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor('mic-to-16k', MicTo16k);
`;

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Int16Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

export interface LiveEvents {
  onStatus: (text: string) => void;
  /** Transcript pieces as they stream in; `done` closes the current line. */
  onTranscript: (who: 'me' | 'ai', text: string, done: boolean) => void;
  onLevel: (rms: number) => void;
  onSpeaking: (speaking: boolean) => void;
  onClose: (reason: string) => void;
  /** The server is about to end the session (Live sessions last about 15 minutes). */
  onWarning?: (secondsLeft: number) => void;
}

export interface LiveCall {
  model: string;
  setMuted: (m: boolean) => void;
  /** Says something to the model as the learner, e.g. "repeat that slower". */
  sendText: (text: string) => void;
  hangUp: () => void;
}

export interface CallOptions {
  system: string;
  /** First instruction, so the partner opens the conversation. */
  opener: string;
  /** Prebuilt voice name; dropped automatically if the model rejects it. */
  voice?: string;
}

/** Opens a session on one model; resolves once the server confirms the setup, rejects with the reason otherwise. */
function openSocket(key: string, model: string, system: string, voice?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}?key=${encodeURIComponent(key)}`);
    let settled = false;
    const fail = (why: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      reject(new Error(why));
    };
    const timer = setTimeout(() => fail('не ответила за 10 с'), SETUP_TIMEOUT_MS);
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              ...(voice ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } : {}),
            },
            systemInstruction: { parts: [{ text: system }] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        }),
      );
    ws.onclose = (e) => fail(e.reason || `соединение закрыто (${e.code})`);
    ws.onerror = () => fail('ошибка соединения');
    ws.onmessage = async (e) => {
      const text = typeof e.data === 'string' ? e.data : await (e.data as Blob).text();
      const msg = JSON.parse(text);
      if (msg.setupComplete && !settled) {
        settled = true;
        clearTimeout(timer);
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        resolve(ws);
      }
    };
  });
}

/**
 * Starts a voice call: tries the Live models in order, then streams the mic up and plays the voice back.
 * Must be called from a tap, so iOS lets the audio start.
 */
export async function startCall({ system, opener, voice }: CallOptions, ev: LiveEvents): Promise<LiveCall> {
  const key = getData().settings.geminiKey;
  if (!key) throw new Error('Нужен ключ Gemini — добавь его в настройках');
  // Created inside the tap: iOS only starts audio from a user gesture
  const ctx = new AudioContext();
  void ctx.resume();

  ev.onStatus('Прошу доступ к микрофону…');
  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    void ctx.close();
    throw new Error('Нет доступа к микрофону — разреши его в настройках браузера');
  }

  ev.onStatus('Ищу голосовые модели…');
  const models = await liveModels(key);
  const errors: string[] = [];
  let ws: WebSocket | null = null;
  let model = '';
  // With a voice first; a model that rejects the voice setting still gets a try with its default voice
  const attempts = models.flatMap((m) => (voice ? [{ m, voice }, { m, voice: undefined }] : [{ m, voice: undefined }]));
  for (const a of attempts) {
    ev.onStatus(`Подключаюсь к ${a.m}…`);
    try {
      ws = await openSocket(key, a.m, system, a.voice);
      model = a.m;
      break;
    } catch (e) {
      errors.push(`${a.m}${a.voice ? ` (голос ${a.voice})` : ''}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (!ws) {
    mic.getTracks().forEach((t) => t.stop());
    void ctx.close();
    throw new Error(`Ни одна голосовая модель не подключилась.\n${errors.join('\n')}`);
  }
  const socket = ws;
  rememberModel(model);

  // Mic -> worklet -> 16 kHz chunks -> socket
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const source = ctx.createMediaStreamSource(mic);
  const node = new AudioWorkletNode(ctx, 'mic-to-16k');
  // A muted sink keeps the worklet running without echoing the mic into the speaker
  const sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(node).connect(sink).connect(ctx.destination);
  let muted = false;
  node.port.onmessage = (e) => {
    const pcm = new Int16Array(e.data as ArrayBuffer);
    let sum = 0;
    for (let i = 0; i < pcm.length; i += 8) sum += (pcm[i] / 0x7fff) ** 2;
    ev.onLevel(muted ? 0 : Math.sqrt(sum / (pcm.length / 8)));
    if (muted || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ realtimeInput: { audio: { data: toBase64(pcm.buffer), mimeType: `audio/pcm;rate=${IN_RATE}` } } }));
  };

  // Model voice: 24 kHz chunks queued back to back; an interruption drops what is still queued
  let playAt = 0;
  const playing = new Set<AudioBufferSourceNode>();
  const play = (pcm: Int16Array) => {
    const buf = ctx.createBuffer(1, pcm.length, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    playAt = Math.max(playAt, ctx.currentTime + 0.05);
    src.start(playAt);
    playAt += buf.duration;
    playing.add(src);
    ev.onSpeaking(true);
    src.onended = () => {
      playing.delete(src);
      if (!playing.size) ev.onSpeaking(false);
    };
  };
  const stopPlayback = () => {
    playing.forEach((s) => {
      try {
        s.stop();
      } catch {
        // already ended
      }
    });
    playing.clear();
    playAt = 0;
    ev.onSpeaking(false);
  };

  socket.onmessage = async (e) => {
    const text = typeof e.data === 'string' ? e.data : await (e.data as Blob).text();
    const msg = JSON.parse(text);
    if (msg.goAway) ev.onWarning?.(parseInt(String(msg.goAway.timeLeft ?? '60'), 10) || 60);
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.interrupted) stopPlayback();
    for (const part of sc.modelTurn?.parts ?? []) if (part.inlineData?.data) play(fromBase64(part.inlineData.data));
    if (sc.inputTranscription?.text) ev.onTranscript('me', sc.inputTranscription.text, false);
    if (sc.outputTranscription?.text) ev.onTranscript('ai', sc.outputTranscription.text, false);
    if (sc.turnComplete) {
      ev.onTranscript('me', '', true);
      ev.onTranscript('ai', '', true);
    }
  };

  let closed = false;
  const cleanup = (reason: string) => {
    if (closed) return;
    closed = true;
    stopPlayback();
    mic.getTracks().forEach((t) => t.stop());
    node.port.onmessage = null;
    void ctx.close();
    ev.onClose(reason);
  };
  socket.onclose = (e) => cleanup(e.reason || 'Звонок завершён');
  socket.onerror = () => cleanup('Связь прервалась');

  // The partner speaks first
  socket.send(JSON.stringify({ realtimeInput: { text: opener } }));
  ev.onStatus(`На связи: ${model}`);

  return {
    model,
    setMuted: (m) => {
      muted = m;
    },
    sendText: (t) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ realtimeInput: { text: t } }));
    },
    hangUp: () => {
      try {
        socket.close();
      } catch {
        // already closed
      }
      cleanup('Звонок завершён');
    },
  };
}
