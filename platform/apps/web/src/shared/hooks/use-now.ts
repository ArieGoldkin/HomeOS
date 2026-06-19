import { useEffect, useState } from "react";

/**
 * The current time, re-rendered once a minute — drives the tablet masthead clock, the time-of-day
 * greeting, and TimeSpine's NowLine position. Minute resolution (HH:MM) is enough and keeps the
 * always-on tablet calm (no per-second churn). Mock with vi.useFakeTimers + vi.setSystemTime.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
