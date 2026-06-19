import { SettingsList } from "./SettingsList";
import { SettingsRow } from "./SettingsRow";

/** Static version string — bump when releasing new builds. */
const APP_VERSION = "0.0.0";

/**
 * Presentational phone Settings screen (Hebrew, RTL-first, DAY/light theme).
 * No persistence — all rows are static display values.
 */
export function SettingsView() {
  return (
    <div
      dir="rtl"
      className="flex flex-col gap-6 min-h-screen bg-background px-4 py-6"
      data-testid="settings-view"
    >
      {/* כללי — General */}
      <SettingsList title="כללי">
        <SettingsRow label="שפה" value="עברית" />
        <SettingsRow label="אזור זמן" value="ירושלים" />
      </SettingsList>

      {/* אודות — About */}
      <SettingsList title="אודות">
        <SettingsRow label="גרסה" value={APP_VERSION} />
        <SettingsRow label="HomeOS" />
      </SettingsList>
    </div>
  );
}
