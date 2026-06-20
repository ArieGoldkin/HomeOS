import { type EventKind, type ParsedEvent, parsedEventSchema } from "@homeos/shared";
import { PersonChip } from "@shared/board";
import { jerusalemTodayIso } from "@shared/lib";
import { Button, Field, SegmentedControl, type SegmentedOption } from "@shared/ui";
import { useForm } from "react-hook-form";

/** The user-editable fields — parsedEventSchema minus the (synthesized) source_text. */
const formSchema = parsedEventSchema.omit({ source_text: true });

/** The known people offered as assignee chips (mirrors the family roster). */
const PEOPLE = ["אבא", "אמא", "יואב", "נועה"] as const;

// Typed against EventKind so a typo'd value is a compile error and the SegmentedControl needs no cast.
const KIND_OPTIONS: readonly SegmentedOption<EventKind>[] = [
  { value: "event", label: "אירוע" },
  { value: "reminder", label: "תזכורת" },
  { value: "task", label: "משימה" },
];

interface FormValues {
  kind: EventKind;
  title_he: string;
  date_iso: string;
  time: string;
  location: string;
  assignee: string;
}

/** The form's own field keys — guards setError against schema issues whose path isn't a form field. */
const FORM_KEYS = ["kind", "title_he", "date_iso", "time", "location", "assignee"] as const;
function isFormKey(key: unknown): key is keyof FormValues {
  return typeof key === "string" && (FORM_KEYS as readonly string[]).includes(key);
}

export interface AddItemFormProps {
  /** Called with a schema-valid ParsedEvent on a valid submit (source_text synthesized here). */
  onSubmit: (event: ParsedEvent) => void;
  /** Called when the user cancels. */
  onCancel?: () => void;
  /** When true, the submit button is disabled — the double-submit guard while a create is in flight. */
  submitting?: boolean;
}

/**
 * The shared add-an-item form: kind segmented control + title/date/time/location fields + assignee
 * chips. Validates the user-editable fields against `parsedEventSchema` (source_text omitted) and, on
 * success, synthesizes source_text → emits a full ParsedEvent via `onSubmit`. Persistence is wired
 * separately (the useCreateEvent seam) — this form only validates + emits (#96).
 */
export function AddItemForm({ onSubmit, onCancel, submitting }: AddItemFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      kind: "event",
      title_he: "",
      date_iso: jerusalemTodayIso(),
      time: "",
      location: "",
      assignee: "",
    },
  });

  const kind = watch("kind");
  const assignee = watch("assignee");

  const submit = handleSubmit((values) => {
    // Empty optional fields → null (the schema's nullable fields reject "").
    const candidate = {
      kind: values.kind,
      title_he: values.title_he.trim(),
      date_iso: values.date_iso,
      time: values.time ? values.time : null,
      location: values.location ? values.location.trim() : null,
      assignee: values.assignee ? values.assignee : null,
      recurrence: null,
    };

    const result = formSchema.safeParse(candidate);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        // Only attach errors to real form fields — a schema/refinement issue with a non-field path
        // would otherwise set an error RHF can't render (a silent validation gap).
        if (isFormKey(field)) {
          setError(field, { message: issue.message });
        }
      }
      return;
    }

    // Synthesize the required source_text — a manual add has no forwarded original text.
    onSubmit({ ...result.data, source_text: result.data.title_he });
  });

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <SegmentedControl
        aria-label="סוג"
        value={kind}
        onValueChange={(v) => setValue("kind", v)}
        options={KIND_OPTIONS}
      />

      <Field
        id="title_he"
        label="כותרת"
        error={errors.title_he?.message}
        {...register("title_he")}
      />
      <Field
        id="date_iso"
        label="תאריך"
        type="date"
        numeric
        error={errors.date_iso?.message}
        {...register("date_iso")}
      />
      <Field
        id="time"
        label="שעה"
        type="time"
        numeric
        error={errors.time?.message}
        {...register("time")}
      />
      <Field
        id="location"
        label="מיקום"
        error={errors.location?.message}
        {...register("location")}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-medium text-muted-foreground">למי</legend>
        <div className="flex flex-wrap gap-2">
          {PEOPLE.map((name) => (
            <PersonChip
              key={name}
              name={name}
              selected={assignee === name}
              onClick={() => setValue("assignee", assignee === name ? "" : name)}
            />
          ))}
        </div>
      </fieldset>

      <div className="mt-2 flex gap-3">
        <Button type="submit" variant="primary" className="flex-1" disabled={submitting}>
          הוספה
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            ביטול
          </Button>
        )}
      </div>
    </form>
  );
}
