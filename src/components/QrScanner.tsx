import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface Props {
  onCode: (code: string) => void;
}

export function QrScanner({ onCode }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let done = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    const tick = () => {
      const v = videoRef.current;
      if (done || !v) return;
      if (v.readyState >= v.HAVE_ENOUGH_DATA && v.videoWidth) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (qr?.data) {
          done = true;
          stream?.getTracks().forEach((t) => t.stop());
          onCode(qr.data);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        stream = s;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = s;
        void v.play();
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setError('Нет доступа к камере. Разреши его в настройках или вставь код вручную.'));

    return () => {
      done = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  return (
    <div className="scanner">
      {error ? <p className="error">{error}</p> : <video ref={videoRef} playsInline muted />}
    </div>
  );
}
