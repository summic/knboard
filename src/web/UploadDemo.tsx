import { useEffect, useRef, useState } from "react";
import { UploadManager, type Uploads, type UploadItem } from "./UploadManager";

// Fake files with different per-tick rates so they finish at staggered times —
// small SVG first, big DMG last — to show per-file bars + total progress.
const FILES: { name: string; ext: string; size: number; rate: number }[] = [
  { name: "box.svg", ext: "SVG", size: 293_940, rate: 0.07 },
  { name: "产品规划.key", ext: "KEY", size: 8_400_000, rate: 0.05 },
  { name: "Telegram.dmg", ext: "DMG", size: 123_000_000, rate: 0.045 },
];

const SPEEDS: [number, string][] = [
  [0.5, "慢"],
  [1, "正常"],
  [2, "快"],
];

// Standalone showcase that drives the real UploadManager UI with simulated,
// slowly-advancing progress so the whole upload animation is watchable.
export function UploadDemo() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [speed, setSpeed] = useState(0.5);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => () => clearInterval(timer.current), []);

  const play = () => {
    clearInterval(timer.current);
    setItems(FILES.map((f, i) => ({ id: `demo-${i}`, name: f.name, ext: f.ext, size: f.size, loaded: 0, status: "uploading" })));
    setOpen(true);
    setCollapsed(false);
    timer.current = setInterval(() => {
      setItems((prev) => {
        const next = prev.map((it, i) => {
          if (it.status !== "uploading") return it;
          const inc = it.size * FILES[i].rate * speedRef.current * (0.7 + Math.random() * 0.6);
          const loaded = Math.min(it.size, it.loaded + inc);
          return loaded >= it.size
            ? { ...it, loaded: it.size, status: "done" as const, url: `/u/demo/${encodeURIComponent(it.name)}` }
            : { ...it, loaded };
        });
        if (next.every((x) => x.status !== "uploading")) clearInterval(timer.current);
        return next;
      });
    }, 220);
  };

  const cancel = (id: string) =>
    setItems((prev) => prev.map((x) => (x.id === id && x.status === "uploading" ? { ...x, status: "canceled" } : x)));
  const cancelAll = () => {
    clearInterval(timer.current);
    setItems((prev) => prev.map((x) => (x.status === "uploading" ? { ...x, status: "canceled" } : x)));
  };
  const close = () => {
    clearInterval(timer.current);
    setOpen(false);
  };

  const uploads: Uploads = { items, open, collapsed, setCollapsed, start: () => {}, cancel, cancelAll, close };

  return (
    <div className="demo-page">
      <div className="demo-head">
        <h1>上传动画预览</h1>
        <p>缓慢演示：面板打开 → 每个文件进度条 + 底部总进度 → 绿色成功横幅。</p>
      </div>
      <div className="demo-controls">
        <button className="btn-primary demo-play" onClick={play}>
          ▶ 播放上传动画
        </button>
        <span className="demo-speed">
          速度：
          {SPEEDS.map(([v, label]) => (
            <button
              key={v}
              className={`demo-speed-btn ${speed === v ? "is-active" : ""}`}
              onClick={() => setSpeed(v)}
            >
              {label}
            </button>
          ))}
        </span>
      </div>
      <div className="demo-stage">
        {open ? (
          <UploadManager uploads={uploads} onAddFiles={play} onAddFolder={play} />
        ) : (
          <div className="demo-hint">点击「播放上传动画」开始</div>
        )}
      </div>
    </div>
  );
}
