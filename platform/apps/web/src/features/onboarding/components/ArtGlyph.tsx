export interface ArtGlyphProps {
  glyph: string;
}

/** Decorative per-step illustration (a large glyph in a soft tile). Purely ornamental → aria-hidden. */
export function ArtGlyph({ glyph }: ArtGlyphProps) {
  return (
    <div
      aria-hidden="true"
      className="flex size-20 items-center justify-center rounded-[calc(var(--radius)*1.5)] bg-secondary text-4xl"
    >
      {glyph}
    </div>
  );
}
