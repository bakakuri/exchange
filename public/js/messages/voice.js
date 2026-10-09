// js/messages/voice.js - voice messages.
//   startRecording({ onLevel, onTick })  -> recorder { stop(), cancel() }
//       Records the microphone (Opus in WebM where the browser has it,
//       MP4/AAC on Safari), reports the live level for the meter and keeps
//       a 48-bar waveform of the whole message (the chat stops it at
//       MAX_VOICE_MS).
//   audioPlayer({ url, durationMs, waveform, name })
//       A compact player: play/pause, the waveform filling up as it plays
//       (tap or drag it to jump), the time, and 1x / 1.5x / 2x speed. Only
//       one plays at a time.

import { createEl } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { t } from '../core/i18n.js';
import { formatDuration } from './format.js';

// The chat stops and sends a recording at this length.
export const MAX_VOICE_MS = 10 * 60 * 1000;
const BARS = 48;

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];

export function canRecord() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

function squeeze(samples, bars) {
  if (!samples.length) return Array(bars).fill(8);
  const out = [];
  for (let i = 0; i < bars; i += 1) {
    const from = Math.floor((i * samples.length) / bars);
    const to = Math.max(from + 1, Math.floor(((i + 1) * samples.length) / bars));
    out.push(Math.max(...samples.slice(from, to)));
  }
  const peak = Math.max(...out, 0.05);
  return out.map((v) => Math.max(6, Math.round((v / peak) * 100)));
}

/** Rejects with Error('denied') when the microphone isn't allowed. */
export async function startRecording({ onLevel, onTick } = {}) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (err) {
    throw new Error(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'unavailable');
  }

  const mimeType = MIME_TYPES.find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const context = AudioCtx ? new AudioCtx() : null;
  const analyser = context?.createAnalyser();
  if (context && analyser) {
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
  }
  const buffer = analyser ? new Uint8Array(analyser.fftSize) : null;
  const samples = [];
  const startedAt = performance.now();

  const meter = setInterval(() => {
    const elapsed = performance.now() - startedAt;
    onTick?.(elapsed);
    if (analyser) {
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (const v of buffer) sum += ((v - 128) / 128) ** 2;
      const level = Math.min(1, Math.sqrt(sum / buffer.length) * 3);
      samples.push(level);
      onLevel?.(level);
    }
  }, 80);

  recorder.start(250);

  function release() {
    clearInterval(meter);
    stream.getTracks().forEach((track) => track.stop());
    context?.close?.().catch(() => {});
  }

  return {
    stop() {
      return new Promise((resolve) => {
        const durationMs = Math.round(performance.now() - startedAt);
        recorder.onstop = () => {
          release();
          const type = (recorder.mimeType || mimeType || 'audio/webm').split(';')[0];
          resolve({ blob: new Blob(chunks, { type }), type, durationMs, waveform: squeeze(samples, BARS) });
        };
        if (recorder.state !== 'inactive') recorder.stop();
        else recorder.onstop();
      });
    },
    cancel() {
      recorder.onstop = release;
      if (recorder.state !== 'inactive') recorder.stop();
      else release();
    },
    get elapsed() {
      return performance.now() - startedAt;
    },
  };
}

// ── player ───────────────────────────────────────────────────────────────────

let playing = null; // the player element now playing

export function audioPlayer({ url, durationMs = 0, waveform = null, name = '' }) {
  const bars = (Array.isArray(waveform) && waveform.length ? waveform : Array(BARS).fill(24))
    .slice(0, 96).map((v) => Math.max(6, Math.min(100, Number(v) || 6)));
  const playBtn = createEl('button', { type: 'button', class: 'vplayer__play', 'aria-label': t('Play') }, [icon('i-play', { size: 18 })]);
  const wave = createEl('div', {
    class: 'vplayer__wave', role: 'slider', tabindex: '0', 'aria-label': t('Position'),
    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0',
  }, bars.map((h) => createEl('span', { style: `--h: ${h}%` })));
  const time = createEl('span', { class: 'vplayer__time' }, formatDuration(durationMs));
  const speed = createEl('button', { type: 'button', class: 'vplayer__speed', 'aria-label': t('Playback speed') }, '1×');
  const el = createEl('div', { class: 'vplayer' }, [playBtn, wave, time, speed]);
  if (name) el.title = name;

  let audio = null;
  let total = durationMs;
  let rate = 1;

  const progress = () => (audio && total ? Math.min(1, (audio.currentTime * 1000) / total) : 0);
  function paint() {
    const p = progress();
    el.style.setProperty('--p', String(p));
    const lit = Math.round(p * bars.length);
    [...wave.children].forEach((bar, i) => bar.classList.toggle('is-lit', i < lit));
    wave.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    time.textContent = formatDuration(audio && !audio.paused ? audio.currentTime * 1000 : (p ? audio.currentTime * 1000 : total));
  }
  function setIcon(isPlaying) {
    playBtn.replaceChildren(icon(isPlaying ? 'i-pause' : 'i-play', { size: 18 }));
    playBtn.setAttribute('aria-label', isPlaying ? t('Pause') : t('Play'));
    el.classList.toggle('is-playing', isPlaying);
  }
  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio(url);
    audio.preload = 'metadata';
    audio.playbackRate = rate;
    audio.addEventListener('loadedmetadata', () => {
      if (!total && Number.isFinite(audio.duration)) total = audio.duration * 1000;
    });
    audio.addEventListener('timeupdate', paint);
    audio.addEventListener('play', () => setIcon(true));
    audio.addEventListener('pause', () => setIcon(false));
    audio.addEventListener('ended', () => {
      setIcon(false);
      audio.currentTime = 0;
      paint();
      time.textContent = formatDuration(total);
    });
    audio.addEventListener('error', () => {
      el.classList.add('is-broken');
      setIcon(false);
    });
    return audio;
  }

  playBtn.addEventListener('click', () => {
    const a = ensureAudio();
    if (a.paused) {
      if (playing && playing !== el) playing.dispatchEvent(new CustomEvent('vplayer:stop'));
      playing = el;
      a.play().catch(() => el.classList.add('is-broken'));
    } else {
      a.pause();
    }
  });
  el.addEventListener('vplayer:stop', () => audio?.pause());

  function seekTo(clientX) {
    const box = wave.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    const a = ensureAudio();
    if (total) a.currentTime = (ratio * total) / 1000;
    paint();
  }
  let dragging = false;
  wave.addEventListener('pointerdown', (e) => { dragging = true; wave.setPointerCapture(e.pointerId); seekTo(e.clientX); });
  wave.addEventListener('pointermove', (e) => { if (dragging) seekTo(e.clientX); });
  wave.addEventListener('pointerup', () => { dragging = false; });
  wave.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const a = ensureAudio();
    a.currentTime = Math.max(0, a.currentTime + (e.key === 'ArrowRight' ? 5 : -5));
    paint();
  });

  speed.addEventListener('click', () => {
    rate = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    speed.textContent = `${rate}×`;
    if (audio) audio.playbackRate = rate;
  });

  return el;
}
