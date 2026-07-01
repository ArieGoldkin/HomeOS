import { requestBindingCode } from "@shared/api";
import { type UseMutationResult, useMutation } from "@tanstack/react-query";

/**
 * #228 — mint a fresh wa.me binding code via `POST /binding`. A MUTATION (not a query): each call issues a
 * NEW single-use code with its own ~10-min TTL, so it's fired on explicit user intent (a "get code" button)
 * rather than on every mount. No cache to invalidate — the code is ephemeral and shown once; the durable
 * result (a `family_phones` row) lands only after the user echoes it to the bot and appears in the owner's
 * LinkedPhones list. The mutation `data` is the code string.
 */
export function useBindingCode(): UseMutationResult<string, Error, void> {
  return useMutation({
    mutationFn: () => requestBindingCode(),
  });
}
