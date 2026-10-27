import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { ArrowRight, Lock, RotateCw, WifiOff } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { useAppearance } from "@/hooks/useAppearance";
import { useAuth } from "@/hooks/useAuth";
import { useContentCollapse } from "@/hooks/useContentCollapse";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useSiteMetadata } from "@/hooks/useSiteMetadata";
import { readStoredSiteMetadata } from "@/hooks/useSiteMetadata";
import { useMetricColorsSync } from "@/hooks/useMetricColors";
import { useNodeStoreStatus } from "@/hooks/useNode";
import { HomeSkeleton } from "./HomeSkeleton";

const COLLAPSE_DURATION_MS = 420;
// 服务端渲染（含静态渲染测试）没有布局阶段，退化到 useEffect 避免告警。
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function AppShell() {
  useAppearance();
  useSiteMetadata();
  useMetricColorsSync();
  const { isCollapsed: contentCollapsed } = useContentCollapse();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const wasCollapsed = useRef(contentCollapsed);

  // 折叠过渡：按内容真实高度逐像素收起/展开，而不是 display 切换。
  // 快捷栏是固定定位的后代，不会被 overflow 裁掉，所以折叠后仍然可操作。
  useIsomorphicLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    if (wasCollapsed.current === contentCollapsed) {
      // 首次挂载就处于折叠态（HMR 或重新挂载）时直接落地，不播放补间动画。
      if (contentCollapsed) {
        node.style.height = "0px";
        node.style.overflow = "hidden";
      }
      return;
    }
    wasCollapsed.current = contentCollapsed;
    // 闭包内无法沿用类型收窄，先落成非空别名。
    const element = node;

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let timer: number | undefined = undefined;

    function settle() {
      element.style.height = contentCollapsed ? "0px" : "";
      element.style.overflow = contentCollapsed ? "hidden" : "";
    }

    function cleanup() {
      if (timer !== undefined) window.clearTimeout(timer);
      element.removeEventListener("transitionend", handleTransitionEnd);
    }

    function handleTransitionEnd(event: TransitionEvent) {
      if (event.target !== element || event.propertyName !== "height") return;
      cleanup();
      settle();
    }

    element.style.transition = reduceMotion ? "none" : "";
    element.style.overflow = "hidden";
    element.style.height = `${element.getBoundingClientRect().height}px`;
    // 读一次布局，确保过渡从当前高度起步。
    element.getBoundingClientRect();

    if (reduceMotion) {
      settle();
      return;
    }

    element.style.height = contentCollapsed ? "0px" : `${element.scrollHeight}px`;
    element.addEventListener("transitionend", handleTransitionEnd);
    // 兜底：高度差为 0 时浏览器不会派发 transitionend。
    timer = window.setTimeout(() => {
      cleanup();
      settle();
    }, COLLAPSE_DURATION_MS + 60);

    return cleanup;
  }, [contentCollapsed]);

  const { pathname, search } = useLocation();
  const publicConfig = usePublicConfig();
  const auth = useAuth();
  const cachedMeta = readStoredSiteMetadata();
  const siteName =
    publicConfig.data?.sitename?.trim() ||
    cachedMeta.siteName ||
    (publicConfig.isPending ? "" : "Komari");
  const normalizedPath = (pathname.replace(/\/+$/, "") || "/").toLowerCase();
  const isDataRoute =
    normalizedPath === "/" ||
    normalizedPath === "/assets" ||
    normalizedPath === "/traffic" ||
    normalizedPath.startsWith("/instance/");
  const isCheckingAccess =
    isDataRoute &&
    (publicConfig.isPending ||
      (publicConfig.data?.private_site === true && auth.isPending));
  const isMockError =
    new URLSearchParams(search).get("mock_error") === "1" ||
    new URLSearchParams(search).get("mock-error") === "1" ||
    (typeof window !== "undefined" &&
      (new URLSearchParams(window.location.search).get("mock_error") === "1" ||
        new URLSearchParams(window.location.search).get("mock-error") === "1"));
  const accessError =
    isMockError || (isDataRoute && publicConfig.isError && !publicConfig.data);
  const isPrivateVisitor =
    isDataRoute &&
    publicConfig.data?.private_site === true &&
    !auth.isPending &&
    auth.data?.logged_in !== true;
  const isThemeManage =
    new URLSearchParams(search).get("view") === "theme-manage" ||
    (typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("view") === "theme-manage");
  const isHomeDashboard = normalizedPath === "/" && !isThemeManage;
  // 并发直出：首页默认并发拉取节点，消除瀑布流排队；若后续判定私有则由 isPrivateVisitor 安全拦截
  const canHydrateHome =
    isHomeDashboard &&
    !accessError &&
    !isPrivateVisitor &&
    !(publicConfig.data?.private_site === true && !auth.data?.logged_in);
  const homeStoreStatus = useNodeStoreStatus(canHydrateHome);
  const isCheckingHomeData =
    canHydrateHome && !homeStoreStatus.hydrated && !homeStoreStatus.nodeInfoError;
  const isCheckingShell = isCheckingAccess || isCheckingHomeData;
  return (
    <div
      className={`app-shell relative flex min-h-screen flex-col${
        contentCollapsed ? " is-content-collapsed" : ""
      }`}
    >
      {/* MAO 风格顶部导航 Bar 框架 */}
      <header className="mao-top-nav-bar">
        <div className="mx-auto flex h-14 w-full max-w-430 items-center justify-between px-3 sm:px-5 md:px-6 lg:px-8">
          <div className="mao-nav-brand-left flex items-center gap-2.5">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-(--text-primary)"
            >
              <path stroke="none" d="M0 0h24v24H0z" fill="none" />
              <path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
              <path d="M16.924 11.132a5 5 0 1 0 -4.056 5.792" />
              <path d="M3 12a9 9 0 1 0 9 -9" />
            </svg>
            <span className="mao-nav-title" title={siteName}>
              {siteName}
            </span>
          </div>
          <div className="flex items-center gap-2 min-w-9" />
        </div>
      </header>
      <main
        id="app-main"
        className="app-main flex-1 px-3 pb-2 pt-6 sm:px-5 md:px-6 lg:px-8"
      >
        <div className="app-content-collapse" ref={contentRef}>
          <div className="mx-auto w-full max-w-430">
            {isCheckingShell ? (
              isHomeDashboard && !isPrivateVisitor ? (
                <HomeSkeleton />
              ) : (
                <div className="flex min-h-[60vh] items-center justify-center">
                  <Spinner size={24} />
                </div>
              )
            ) : accessError ? (
              <AccessError onRetry={() => void publicConfig.refetch()} />
            ) : isPrivateVisitor ? (
              <PrivateSiteGate />
            ) : (
              <Outlet />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function AccessError({ onRetry }: { onRetry: () => void }) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      if (sp.has("mock_error") || sp.has("mock-error")) {
        sp.delete("mock_error");
        sp.delete("mock-error");
        const nextUrl =
          window.location.pathname + (sp.toString() ? `?${sp.toString()}` : "");
        window.location.href = nextUrl;
        return;
      }
      window.location.reload();
    } else {
      onRetry();
    }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center py-10">
      <section className="access-error-card" role="alert" aria-live="assertive">
        <div className="access-error-icon-wrap" aria-hidden="true">
          <WifiOff size={22} strokeWidth={2} />
        </div>
        <div className="space-y-1.5">
          <h2 className="access-error-title">无法读取站点配置</h2>
          <p className="access-error-desc">
            与监控服务通信失败或接口未响应，请检查网络连接后重试。
          </p>
        </div>
        <div className="access-error-actions">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="access-error-refresh-btn"
          >
            <RotateCw
              size={14}
              className={refreshing ? "animate-spin" : ""}
              aria-hidden="true"
            />
            <span>{refreshing ? "正在刷新…" : "刷新页面"}</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function PrivateSiteGate() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center py-10">
      <section className="access-error-card" role="alert">
        <div className="access-error-icon-wrap is-lock" aria-hidden="true">
          <Lock size={22} strokeWidth={2} />
        </div>
        <div className="space-y-1.5">
          <h2 className="access-error-title">站点已设为私有</h2>
          <p className="access-error-desc">
            该探针已被站长设为私有访问，登录后即可查看节点实时状态。
          </p>
        </div>
        <div className="access-error-actions">
          <a
            href="/admin"
            target="_blank"
            rel="noopener noreferrer"
            className="access-error-refresh-btn"
          >
            <span>前往登录</span>
            <ArrowRight size={14} aria-hidden="true" />
          </a>
        </div>
      </section>
    </div>
  );
}
