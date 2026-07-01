import { unbindPhone } from "@shared/api";
import { type UseMutationResult, useMutation, useQueryClient } from "@tanstack/react-query";
import { familyQueryKey } from "./use-family";
import { phonesQueryKey } from "./use-phones";

/**
 * #262 — owner-revoke a WhatsApp sender via `DELETE /phones/:phone` (by digit-normalized `from_phone`). On
 * success it invalidates `phonesQueryKey` (the unbound number drops out of the list) AND `familyQueryKey`
 * (the roster's `family.whatsappConnected` derives from whether any phone remains bound, so unbinding the
 * last one must flip the connections status). The mutation variable is the `from_phone` string.
 */
export function useUnbindPhone(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: unbindPhone,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: phonesQueryKey });
      void qc.invalidateQueries({ queryKey: familyQueryKey });
    },
  });
}
