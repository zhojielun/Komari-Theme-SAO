import { useCallback, useSyncExternalStore } from "react";

// 页面主体折叠是壳层与悬浮快捷栏共享的状态：AppShell 负责高度过渡，
// FloatingControls 负责渲染折叠按钮，所以用外部 store 而不是 props 逐层传递。
let collapsed = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return collapsed;
}

function setContentCollapsed(next: boolean) {
  if (collapsed === next) return;
  collapsed = next;
  for (const listener of listeners) listener();
}

export function useContentCollapse() {
  const isCollapsed = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const toggle = useCallback(() => setContentCollapsed(!collapsed), []);
  return { isCollapsed, toggle };
}
