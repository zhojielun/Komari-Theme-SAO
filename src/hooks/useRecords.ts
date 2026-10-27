import { useQuery } from "@tanstack/react-query";
import { getLoadRecords, getPingRecords, getPingStats, getPublicPingTasks } from "@/services/api";

const RECORD_QUERY_OPTIONS = {
  staleTime: 300_000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export function useLoadRecords(uuid: string, hours = 6, enabled = true) {
  return useQuery({
    queryKey: ["records", "load", uuid, hours],
    queryFn: ({ signal }) => getLoadRecords(uuid, hours, { signal }),
    ...RECORD_QUERY_OPTIONS,
    enabled: Boolean(uuid) && enabled,
  });
}

export function usePingRecords(uuid: string, hours = 6, enabled = true) {
  return useQuery({
    queryKey: ["records", "ping", uuid, hours],
    queryFn: ({ signal }) => getPingRecords(uuid, hours, {
      signal,
      includeStats: false,
      includeTasks: false,
    }),
    ...RECORD_QUERY_OPTIONS,
    enabled: Boolean(uuid) && enabled,
  });
}

// 统计与曲线同时开始但独立返回；缓存键隔离节点和时间范围。
export function usePingRecordStats(uuid: string, hours = 6, enabled = true) {
  return useQuery({
    queryKey: ["records", "ping-stats", uuid, hours],
    queryFn: ({ signal }) => getPingStats(uuid, hours, { signal }),
    ...RECORD_QUERY_OPTIONS,
    enabled: Boolean(uuid) && enabled,
  });
}

export function usePublicPingTasks(enabled = true) {
  return useQuery({
    queryKey: ["public-ping-tasks"],
    queryFn: ({ signal }) => getPublicPingTasks({ signal }),
    ...RECORD_QUERY_OPTIONS,
    staleTime: 60_000,
    enabled,
  });
}
