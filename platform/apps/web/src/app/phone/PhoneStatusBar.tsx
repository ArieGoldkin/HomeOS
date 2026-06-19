import { useNow } from "@shared/hooks";
import { jerusalemHhmm } from "@shared/lib";

/**
 * A deliberately minimal status bar — just the LTR wall clock. The prototype's faux-iOS battery/signal
 * chrome is dropped for prod (it reads as fake on a real device); the clock is the one honest signal.
 */
export function PhoneStatusBar() {
  const now = useNow();
  return (
    <div className="flex items-center justify-end px-5 pt-2 text-[12px] text-muted-foreground">
      <span dir="ltr" className="tabular-nums">
        {jerusalemHhmm(now)}
      </span>
    </div>
  );
}
