import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { Breadcrumb, type Crumb } from "./Breadcrumb";

/**
 * PageSheet —— iOS Page Sheet 风格的卡片堆叠。
 *
 *  - children = 底层（首页）。open 时缩小 + 变暗，整层为返回热区（点它 / ESC 关闭）。
 *  - sheet    = 前层内容，从下滑入；比底层矮，露出底层 header。
 *
 * 头部 chrome 由前层视图通过 useSheetChrome() 发布：
 *  - 面包屑渲染在前层「外部」（顶上旧卡区域），居中、蓝色链接。
 *  - 当前页标题渲染在前层顶部居中，sticky 固定，向上滚动时带半透明毛玻璃遮罩。
 */

export type SheetChrome = { crumbs: Crumb[]; title: ReactNode; actions?: ReactNode };

const ChromeContext = createContext<(c: SheetChrome | null) => void>(() => {});

// Views publish their breadcrumb / title / actions; `deps` gates updates.
// (No clear-on-unmount — that would race the next view's publish. PageSheet
// resets chrome when the sheet closes.)
export function useSheetChrome(chrome: SheetChrome, deps: unknown[]) {
  const set = useContext(ChromeContext);
  useLayoutEffect(() => {
    set(chrome);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function PageSheet({
  open,
  onDismiss,
  children,
  sheet,
  wide = false,
}: {
  open: boolean;
  onDismiss: () => void;
  children: ReactNode;
  sheet: ReactNode;
  wide?: boolean;
}) {
  const [chrome, setChrome] = useState<SheetChrome | null>(null);

  useEffect(() => {
    if (!open) {
      setChrome(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  return (
    <ChromeContext.Provider value={setChrome}>
      <div className="pagesheet">
        <div
          className="pagesheet-back"
          data-open={open || undefined}
          onClick={open ? onDismiss : undefined}
          role={open ? "button" : undefined}
          aria-label={open ? "返回" : undefined}
        >
          {children}
        </div>

        {open && (
          <>
            {/* breadcrumb lives outside the card, in the old-card peek area */}
            <div className="pagesheet-crumbs">
              {chrome && chrome.crumbs.length > 0 && <Breadcrumb items={chrome.crumbs} />}
            </div>

            <div
              className={`pagesheet-front ${wide ? "is-wide" : ""}`}
              role="region"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sheet-scroll">
                <div className="sheet-titlebar">
                  <h2 className="sheet-title">{chrome?.title}</h2>
                  {chrome?.actions && <div className="sheet-actions">{chrome.actions}</div>}
                </div>
                <div className="sheet-content">{sheet}</div>
              </div>
            </div>
          </>
        )}
      </div>
    </ChromeContext.Provider>
  );
}
