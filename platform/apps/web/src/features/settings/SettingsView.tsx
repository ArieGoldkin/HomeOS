import { type Theme, useTheme } from "@shared/theme";
import { SegmentedControl, type SegmentedOption, Switch } from "@shared/ui";
import { useState } from "react";
import { ProfileCard } from "./components/ProfileCard";
import { SettingsList } from "./components/SettingsList";
import { SettingsRow } from "./components/SettingsRow";

/** Static version string — bump when releasing new builds. */
const APP_VERSION = "0.0.0";

const THEME_OPTIONS: SegmentedOption<Theme>[] = [
  { value: "light", label: "בהיר" },
  { value: "dark", label: "כהה" },
];

/** Client-only notification prefs — there's no backend for these yet, so the switches are a mock. */
const NOTIFICATION_ROWS = [
  { key: "events", label: "תזכורות לאירועים" },
  { key: "digest", label: "סיכום יומי" },
  { key: "system", label: "עדכוני מערכת" },
] as const;

type NotifKey = (typeof NOTIFICATION_ROWS)[number]["key"];

/**
 * The Settings screen (#183) — re-skinned onto the Modern shell idiom (kicker + display heading + Card
 * sections). Profile (presentational) · Appearance (the light/dark theme toggle, wired to the shared
 * ThemeProvider via useTheme — in sync with the AppShell header toggle, persisted) · Connected services
 * (the same ConnectionCard tiles as Connections) · Notifications (mock Switch rows) · the kept static
 * General/About rows. Real identity, persisted prefs, and the he/en language toggle are DEFERRED.
 */
export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const [notifs, setNotifs] = useState<Record<NotifKey, boolean>>({
    events: true,
    digest: true,
    system: false,
  });

  return (
    <div className="flex flex-col gap-7" data-testid="settings-view">
      <header>
        <div className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
          החשבון וההעדפות
        </div>
        <h1 className="mt-2 font-display font-extrabold text-[34px] text-[color:var(--ink)] leading-[1.05] tracking-tight">
          ההגדרות <span className="font-accent font-medium text-primary">שלי</span>
        </h1>
      </header>

      <ProfileCard />

      <SettingsList title="מראה">
        <SettingsRow
          label="ערכת נושא"
          control={
            <SegmentedControl<Theme>
              aria-label="ערכת נושא"
              value={theme}
              onValueChange={setTheme}
              options={THEME_OPTIONS}
            />
          }
        />
      </SettingsList>

      <SettingsList title="התראות">
        {NOTIFICATION_ROWS.map((row) => (
          <SettingsRow
            key={row.key}
            label={row.label}
            control={
              <Switch
                aria-label={row.label}
                checked={notifs[row.key]}
                onCheckedChange={(v) => setNotifs((prev) => ({ ...prev, [row.key]: v }))}
              />
            }
          />
        ))}
      </SettingsList>

      <SettingsList title="כללי">
        <SettingsRow label="שפה" value="עברית" />
        <SettingsRow label="אזור זמן" value="ירושלים" />
      </SettingsList>

      <SettingsList title="אודות">
        <SettingsRow label="גרסה" value={APP_VERSION} />
        <SettingsRow label="HomeOS" />
      </SettingsList>
    </div>
  );
}
