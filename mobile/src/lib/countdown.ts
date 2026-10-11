import { useEffect, useState } from 'react';

// Seconds left while `active`, ticking from `seconds`; back to `seconds` once it stops.
// Shown as m:ss ("0:42"), like Revolut's "Resend code in 00:58", so a long wait reads as progress.
export function useCountdown(active: boolean, seconds: number) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (!active) return;
    const end = Date.now() + seconds * 1000;
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000))), 250);
    return () => {
      clearInterval(t);
      setLeft(seconds);
    };
  }, [active, seconds]);
  return active ? left : seconds;
}

export const formatClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
