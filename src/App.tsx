import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useDropzone } from "react-dropzone";
import "./App.css";

type Detection = {
  label: string;
  score: number;
};

type AnalyzeResult = {
  name: string;
  detections: Detection[];
  engine: string;
  width: number;
  height: number;
};

type ModelStatus = {
  loaded: boolean;
  active_path: string | null;
  expected_paths: string[];
  labels_path: string;
};

type ItemStatus = "processing" | "done" | "error";
type View = "menu" | "recent" | "about";

type ProcessedItem = {
  id: string;
  batchId: string;
  name: string;
  status: ItemStatus;
  detections: Detection[];
  engine?: string;
  dimensions?: string;
  error?: string;
  createdAt: number;
};

const SCORE_FORMAT = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

const isMac = navigator.platform.toLowerCase().includes("mac");
const selectShortcut = isMac ? "⌘O" : "Ctrl+O";
const clipboardShortcut = isMac ? "⌘⇧V" : "Ctrl+Shift+V";
const recentShortcut = isMac ? "⌘Y" : "Ctrl+Y";
const quitShortcut = isMac ? "⌘Q" : "Alt+F4";

function App() {
  const [items, setItems] = useState<ProcessedItem[]>([]);
  const [view, setView] = useState<View>("menu");
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [dropHint, setDropHint] = useState("Drag files here...");

  const analyzeFiles = useCallback(async (files: File[]) => {
    const acceptedFiles = files.filter((file) => file.type.startsWith("image/"));
    if (acceptedFiles.length === 0) {
      setDropHint("Only images supported");
      return;
    }

    const batchId = crypto.randomUUID();
    const createdAt = Date.now();
    setView("recent");

    for (const file of acceptedFiles) {
      const id = crypto.randomUUID();
      setItems((prev) => [
        {
          id,
          batchId,
          name: file.name,
          status: "processing",
          detections: [],
          createdAt,
        },
        ...prev,
      ]);

      try {
        const buffer = await file.arrayBuffer();
        const bytes = Array.from(new Uint8Array(buffer));
        const result = await invoke<AnalyzeResult>("analyze_image", {
          name: file.name,
          bytes,
        });

        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: "done",
                  detections: result.detections,
                  engine: result.engine,
                  dimensions: `${result.width}×${result.height}`,
                }
              : item,
          ),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to analyze image.";
        setItems((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: "error",
                  error: message,
                }
              : item,
          ),
        );
      }
    }
  }, []);

  const handleClipboard = useCallback(async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      const files: File[] = [];

      for (const item of clipboardItems) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) {
          continue;
        }

        const blob = await item.getType(imageType);
        const extension = imageType.split("/")[1] ?? "png";
        files.push(new File([blob], `clipboard-image.${extension}`, { type: imageType }));
      }

      await analyzeFiles(files);
    } catch {
      const id = crypto.randomUUID();
      setItems((prev) => [
        {
          id,
          batchId: id,
          name: "Clipboard",
          status: "error",
          detections: [],
          error: "Clipboard image unavailable.",
          createdAt: Date.now(),
        },
        ...prev,
      ]);
      setView("recent");
    }
  }, [analyzeFiles]);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const { getRootProps, getInputProps, isDragActive, isDragReject, open } =
    useDropzone({
      onDrop: analyzeFiles,
      onDragEnter: () => setDropHint("Release to analyze"),
      onDragLeave: () => setDropHint("Drag files here..."),
      accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif"] },
      multiple: true,
      noClick: true,
      noKeyboard: true,
    });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === "o") {
        event.preventDefault();
        open();
      }

      if (mod && event.shiftKey && key === "v") {
        event.preventDefault();
        handleClipboard();
      }

      if (mod && key === "y") {
        event.preventDefault();
        setView("recent");
      }

      if (event.key === "Escape" || (mod && key === "w")) {
        event.preventDefault();
        invoke("hide_main_window");
      }

      if (mod && key === "q") {
        event.preventDefault();
        invoke("quit_app");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClipboard, open]);

  useEffect(() => {
    invoke<ModelStatus>("model_status")
      .then(setModelStatus)
      .catch(() => setModelStatus(null));

    const listeners = [
      listen("show-about", () => setView("about")),
      listen("show-recent", () => setView("recent")),
      listen("open-file-picker", () => open()),
      listen("upload-from-clipboard", () => handleClipboard()),
    ];

    return () => {
      listeners.forEach((listener) => listener.then((stop) => stop()));
    };
  }, [handleClipboard, open]);

  const latestBatchId = items[0]?.batchId;
  const latestItems = useMemo(
    () => items.filter((item) => item.batchId === latestBatchId),
    [items, latestBatchId],
  );
  const recentItems = view === "recent" ? items : latestItems;
  const modelCopy = modelStatus?.loaded
    ? `TensorFlow model: ${modelStatus.active_path}`
    : "No .pb model found. Demo fallback active.";

  const zoneText = isDragReject
    ? "Unsupported file"
    : isDragActive
      ? "Drop to analyze"
      : dropHint;

  return (
    <main className="app">
      {view !== "menu" && (
        <button className="back-button" type="button" onClick={() => setView("menu")}>
          ‹
        </button>
      )}

      {view === "menu" && (
        <>
          <div
            className={`dropzone ${isDragActive ? "dropzone-active" : ""} ${
              isDragReject ? "dropzone-reject" : ""
            }`}
            {...getRootProps()}
          >
            <input {...getInputProps()} />
            <span className="drop-icon">↥</span>
            <span>{zoneText}</span>
          </div>

          <nav className="menu-list" aria-label="TauriSight actions">
            <MenuButton label="Select file" shortcut={selectShortcut} onClick={open} />
            <MenuButton
              label="Upload from clipboard"
              shortcut={clipboardShortcut}
              onClick={handleClipboard}
            />
            <MenuButton
              label="Recent uploads"
              shortcut={recentShortcut}
              onClick={() => setView("recent")}
            />

            <div className="separator" />

            <MenuButton label="About TauriSight..." onClick={() => setView("about")} />
            <MenuButton label="Check for updates" disabled />

            <div className="separator" />

            <MenuButton label="Settings" shortcut={isMac ? "⌘," : "Ctrl+,"} disabled />
            <MenuButton label="Quit" shortcut={quitShortcut} onClick={() => invoke("quit_app")} />
          </nav>
        </>
      )}

      {view === "recent" && (
        <section className="panel">
          <header className="panel-header">
            <div>
              <p className="eyebrow">TauriSight</p>
              <h1>Recent uploads</h1>
            </div>
            <span className="count">{items.length}</span>
          </header>

          <div className="results">
            {recentItems.length === 0 && <div className="empty">No processed files yet.</div>}
            {recentItems.map((item) => (
              <ResultCard key={item.id} item={item} onRemove={removeItem} />
            ))}
          </div>
        </section>
      )}

      {view === "about" && (
        <section className="panel">
          <header className="panel-header">
            <div>
              <p className="eyebrow">TauriSight</p>
              <h1>About</h1>
            </div>
          </header>

          <div className="about-panel">
            <p>{modelCopy}</p>
            <p>Model: <code>src-tauri/models/vision_model.pb</code></p>
            <p>Labels: <code>src-tauri/models/labels.txt</code></p>
          </div>
        </section>
      )}
    </main>
  );
}

function MenuButton({
  label,
  shortcut,
  disabled,
  onClick,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className="menu-item" type="button" disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

function ResultCard({
  item,
  onRemove,
}: {
  item: ProcessedItem;
  onRemove: (id: string) => void;
}) {
  return (
    <article className="result-card">
      <div className="result-top">
        <div>
          <p className="file-name">{item.name}</p>
          <p className={`status status-${item.status}`}>
            {item.status === "processing" && "Processing..."}
            {item.status === "done" &&
              `${item.engine ?? "Ready"}${item.dimensions ? ` · ${item.dimensions}` : ""}`}
            {item.status === "error" && "Failed"}
          </p>
        </div>
        <button
          type="button"
          className="close-button"
          onClick={() => onRemove(item.id)}
          aria-label="Remove item"
        >
          ×
        </button>
      </div>

      {item.status === "error" && <p className="error-text">{item.error}</p>}

      {item.status === "done" && (
        <ul className="detections">
          {item.detections.length === 0 && (
            <li className="muted">No confident detections.</li>
          )}
          {item.detections.map((detection) => (
            <li key={`${item.id}-${detection.label}`}>
              <span>{detection.label}</span>
              <span>{SCORE_FORMAT.format(detection.score)}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export default App;
