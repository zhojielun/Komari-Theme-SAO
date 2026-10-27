import { QueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@/services/api";
import { HttpRequestError } from "@/services/requestErrors";

function shouldRetry(failureCount: number, error: unknown) {
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) {
    return false;
  }
  if (
    ((error instanceof ApiRequestError || error instanceof HttpRequestError) &&
      error.status >= 400 &&
      error.status < 500 &&
      ![408, 425, 429].includes(error.status))
  ) {
    return false;
  }
  return failureCount < 1;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: shouldRetry,
    },
  },
});
