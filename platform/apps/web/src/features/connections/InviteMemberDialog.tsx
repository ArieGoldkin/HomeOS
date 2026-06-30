import { Button, Dialog, Field } from "@shared/ui";
import { useForm } from "react-hook-form";
import { useInviteController } from "./use-invite";

interface FormValues {
  email: string;
}

export interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional notification fired after an invite is successfully minted (analytics/tests). */
  onCreated?: () => void;
}

/**
 * #250 — the owner's "invite a household member" dialog: an email-only form (the role is implicitly `member`
 * — design §10 forbids a viewer-role UI this slice) inside the responsive {@link Dialog}. Submitting mints a
 * pending invite (`POST /invites`); the invitee's next Google login claims it. Persistence + reset-on-close
 * live in {@link useInviteController}; this is just the form. The email is LTR inside the RTL layout.
 */
export function InviteMemberDialog({ open, onOpenChange, onCreated }: InviteMemberDialogProps) {
  const { submitting, isError, submit, close } = useInviteController(onOpenChange, onCreated);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { email: "" } });

  const onSubmit = handleSubmit((values) => {
    submit({ email: values.email.trim(), role: "member" });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="הזמנת בן/בת בית"
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <p className="text-[13px] text-muted-foreground">
          הזינו את כתובת ה-Google של בן/בת הבית. בכניסה הבאה שלהם עם החשבון הזה הם יצורפו אוטומטית —
          אין צורך בקוד.
        </p>
        <Field
          id="invite-email"
          label="כתובת Google"
          type="email"
          dir="ltr"
          placeholder="name@gmail.com"
          error={errors.email?.message}
          {...register("email", {
            required: "נא להזין כתובת אימייל",
            validate: (v) => v.trim().includes("@") || "כתובת אימייל לא תקינה",
          })}
        />
        <div className="mt-2 flex gap-3">
          <Button type="submit" variant="primary" className="flex-1" disabled={submitting}>
            שליחת הזמנה
          </Button>
          <Button type="button" variant="ghost" onClick={close}>
            ביטול
          </Button>
        </div>
        {isError && (
          <p role="alert" className="text-[13px] text-coral">
            לא הצלחנו לשלוח את ההזמנה. נסו שוב.
          </p>
        )}
      </form>
    </Dialog>
  );
}
