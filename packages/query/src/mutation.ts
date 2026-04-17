import {
  createMutation as tanstackCreateMutation,
  type CreateMutationOptions,
  type QueryKey,
} from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import type { AppError } from '@sveltesentio/core';

export type { CreateMutationOptions };

type ToastMessage<TData, TVariables> =
  | string
  | ((data: TData, variables: TVariables) => string);

type ToastErrorMessage<TError> =
  | string
  | ((error: TError) => string);

export interface SentioMutationOptions<
  TData = unknown,
  TVariables = void,
  TContext = unknown,
  TError = AppError,
> extends Omit<
    CreateMutationOptions<TData, TError, TVariables, TContext>,
    'onSuccess' | 'onError'
  > {
  mutationFn: (variables: TVariables) => Promise<TData>;

  /** Query keys to invalidate after a successful mutation. */
  invalidates?: QueryKey[];

  /** Toast message on success. String or function returning string. */
  onSuccess?: ToastMessage<TData, TVariables> | CreateMutationOptions<TData, TError, TVariables, TContext>['onSuccess'];

  /** Toast message on error. String or function returning string. */
  onError?: ToastErrorMessage<TError> | CreateMutationOptions<TData, TError, TVariables, TContext>['onError'];
}

/**
 * createMutation with built-in svelte-sonner toast feedback and cache invalidation.
 *
 * const save = createMutation({
 *   mutationFn: (data) => api.PUT('/items/{id}', { body: data }),
 *   onSuccess: 'Saved!',
 *   onError: (err) => `Failed: ${err.message}`,
 *   invalidates: [['items']],
 * });
 *
 * <button onclick={() => $save.mutate(formData)}>Save</button>
 */
export function createMutation<
  TData = unknown,
  TVariables = void,
  TContext = unknown,
  TError = AppError,
>(options: SentioMutationOptions<TData, TVariables, TContext, TError>) {
  const { invalidates, onSuccess, onError, ...rest } = options;

  return tanstackCreateMutation<TData, TError, TVariables, TContext>({
    ...rest,
    onSuccess: async (data, variables, context) => {
      if (typeof onSuccess === 'string') {
        toast.success(onSuccess);
      } else if (typeof onSuccess === 'function') {
        const result = (onSuccess as ToastMessage<TData, TVariables>)(data, variables);
        if (typeof result === 'string') {
          toast.success(result);
        } else {
          // It's a TanStack onSuccess callback — call it
          await (onSuccess as NonNullable<CreateMutationOptions<TData, TError, TVariables, TContext>['onSuccess']>)(
            data,
            variables,
            context,
          );
        }
      }

      if (invalidates && invalidates.length > 0) {
        const { useQueryClient } = await import('@tanstack/svelte-query');
        const client = useQueryClient();
        await Promise.all(invalidates.map((key) => client.invalidateQueries({ queryKey: key })));
      }
    },
    onError: (error, variables, context) => {
      if (typeof onError === 'string') {
        toast.error(onError);
      } else if (typeof onError === 'function') {
        const result = (onError as ToastErrorMessage<TError>)(error);
        if (typeof result === 'string') {
          toast.error(result);
        } else {
          (onError as NonNullable<CreateMutationOptions<TData, TError, TVariables, TContext>['onError']>)(
            error,
            variables,
            context,
          );
        }
      }
    },
  });
}
