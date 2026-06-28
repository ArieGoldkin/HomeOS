import { updateDisplayName, useCurrentUser } from "@shared/auth";
import { PersonAvatar } from "@shared/board";
import { Button, Card } from "@shared/ui";
import { useState } from "react";

/**
 * The Settings profile card (#183/#230) — avatar + name + email sourced from the signed-in Google
 * session (useCurrentUser), with an inline "עריכה" that writes full_name via supabase.auth.updateUser.
 * On save the auth context refreshes (USER_UPDATED), so the card re-renders with the new name.
 */
export function ProfileCard() {
  const { status, full_name, email, avatar_url } = useCurrentUser();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  // No hardcoded fallback name (#230): prefer the Google full_name, else the email, else empty.
  const displayName = full_name ?? email ?? "";

  if (status === "loading") {
    return (
      <Card className="flex items-center gap-4 p-[18px]" data-testid="profile-card">
        <div className="size-[52px] animate-pulse rounded-full bg-secondary" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 animate-pulse rounded bg-secondary" />
          <div className="h-3 w-48 animate-pulse rounded bg-secondary" />
        </div>
      </Card>
    );
  }

  const startEdit = () => {
    setDraft(full_name ?? "");
    setFailed(false);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setFailed(false);
    try {
      await updateDisplayName(draft.trim());
      setEditing(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="flex items-center gap-4 p-[18px]" data-testid="profile-card">
      <PersonAvatar name={displayName || "?"} imageUrl={avatar_url} size={52} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            aria-label="שם"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            className="w-full rounded-[var(--radius)] border border-input bg-transparent px-3 py-1.5 text-[15px] text-[color:var(--ink)]"
          />
        ) : (
          <p className="font-semibold text-[16px] text-[color:var(--ink)]">{displayName}</p>
        )}
        <p dir="ltr" className="truncate text-start text-[13px] text-ink-soft">
          {email}
        </p>
        {failed && <p className="mt-1 text-[12px] text-destructive">השמירה נכשלה, נסו שוב</p>}
      </div>
      {editing ? (
        <div className="flex shrink-0 gap-2">
          <Button
            variant="ink"
            onClick={save}
            disabled={saving}
            className="min-h-0 rounded-full px-4 py-2 text-[13px]"
          >
            שמירה
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setFailed(false);
            }}
            disabled={saving}
            className="min-h-0 rounded-full px-4 py-2 text-[13px]"
          >
            ביטול
          </Button>
        </div>
      ) : (
        <Button
          variant="ink"
          onClick={startEdit}
          className="min-h-0 shrink-0 rounded-full px-4 py-2 text-[13px]"
        >
          עריכה
        </Button>
      )}
    </Card>
  );
}
