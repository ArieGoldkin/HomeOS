import { cn } from "@shared/lib";

export interface QRConnectBlockProps {
  phone: string;
}

// Static pseudo-QR fill pattern (decorative placeholder until a real QR lands with Connect-Google #10).
const CELLS = Array.from({ length: 25 }, (_, i) => ({ id: i, on: (i * 7) % 3 === 0 }));

/** The "connect WhatsApp" step body: a decorative QR + the HomeOS number to message. */
export function QRConnectBlock({ phone }: QRConnectBlockProps) {
  return (
    <div className="flex w-full items-center gap-4 rounded-[var(--radius)] border border-border bg-card p-4 text-start">
      <div
        aria-hidden="true"
        className="grid size-20 shrink-0 grid-cols-5 gap-0.5 rounded-md bg-foreground/5 p-1"
      >
        {CELLS.map((cell) => (
          <span
            key={cell.id}
            className={cn("rounded-[1px]", cell.on ? "bg-foreground" : "bg-transparent")}
          />
        ))}
      </div>
      <div className="min-w-0">
        <p className="font-medium text-[15px] text-foreground">סרקו כדי לחבר</p>
        <p className="text-[13px] text-muted-foreground">או שלחו הודעה למספר של HomeOS</p>
        <p dir="ltr" className="mt-1 font-semibold text-[14px] text-primary tabular-nums">
          {phone}
        </p>
      </div>
    </div>
  );
}
