import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface Props {
  onCode: (code: string) => void;
}

// Frames are downscaled before decoding: full-res iPhone frames make jsQR too slow
const MAX_SIDE = 720;

export function QrScanner({ onCode }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('Запускаю камеру…');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    const tick = () => {
      const v = videoRef.current;
      if (done || !v) return;
      if (v.videoWidth) {
        const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
        if (qr?.data) {
          done = true;
          stream?.getTracks().forEach((t) => t.stop());
          onCode(qr.data);
          return;
        }
      }
      timer = setTimeout(tick, 120);
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(async (s) => {
        stream = s;
        const v = videoRef.current;
        if (!v || done) return;
        // iOS plays inline video only when these are set as properties, not just JSX attributes
        v.muted = true;
        v.playsInline = true;
        v.setAttribute('playsinline', '');
        v.srcObject = s;
        try {
          await v.play();
          setHint('Наведи камеру на QR-код на экране компа');
        } catch {
          setHint('Нажми на видео, чтобы запустить камеру');
        }
        tick();
      })
      .catch(() => setError('Нет доступа к камере. Разреши его в настройках или вставь код вручную.'));

    if (!navigator.mediaDevices) setError('Камера недоступна в этом браузере. Вставь код вручную.');

    return () => {
      done = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  return (
    <div className="scanner">
      {error ? (
        <p className="error">{error}</p>
      ) : (
        <>
          <video ref={videoRef} playsInline muted autoPlay onClick={() => void videoRef.current?.play()} />
          <p className="muted small">{hint}</p>
        </>
      )}
    </div>
  );
}
