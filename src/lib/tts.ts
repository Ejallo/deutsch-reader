let voice: SpeechSynthesisVoice | null = null;

function pickVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('de'));
  voice = voices.find((v) => v.localService) ?? voices[0] ?? null;
}

if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener('voiceschanged', pickVoice);
}

export function speak(text: string, onEnd?: () => void) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  if (voice) u.voice = voice;
  u.rate = 0.9;
  if (onEnd) {
    u.onend = onEnd;
    u.onerror = onEnd;
  }
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
