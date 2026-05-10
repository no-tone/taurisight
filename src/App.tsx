import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useDropzone } from "react-dropzone";
import "./App.css";

type Prediction = import("@tensorflow-models/coco-ssd").DetectedObject;
type CocoModel = import("@tensorflow-models/coco-ssd").ObjectDetection;
type ItemStatus = "queued" | "uploading" | "analyzing" | "done" | "error";
type View = "menu" | "recent" | "about";

type ProcessedItem = {
  id: string;
  batchId: string;
  name: string;
  status: ItemStatus;
  predictions: Prediction[];
  dimensions?: string;
  error?: string;
  createdAt: number;
};

type Activity = {
  phase: "idle" | "uploading" | "analyzing";
  fileName: string;
  progress: number;
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
  const [dropHint, setDropHint] = useState("Drag files here...");
  const [activity, setActivity] = useState<Activity>({
    phase: "idle",
    fileName: "",
    progress: 0,
  });
  const [aboutMarkdown, setAboutMarkdown] = useState("Loading about...");
  const modelRef = useRef<CocoModel | null>(null);

  const setTrayProgress = useCallback((active: boolean, progress: number, label: string) => {
    invoke("update_tray_progress", {
      progress: {
        active,
        progress: Math.round(progress),
        label,
      },
    }).catch(() => {});
  }, []);

  const loadModel = useCallback(async () => {
    if (modelRef.current) {
      return modelRef.current;
    }

    const [tf, cocoSsd] = await Promise.all([
      import("@tensorflow/tfjs"),
      import("@tensorflow-models/coco-ssd"),
      import("@tensorflow/tfjs-backend-cpu"),
      import("@tensorflow/tfjs-backend-webgl"),
    ]).then(([tfModule, cocoModule]) => [tfModule, cocoModule] as const);

    await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));
    await tf.ready();
    modelRef.current = await cocoSsd.load({ base: "lite_mobilenet_v2" });
    return modelRef.current;
  }, []);

  const updateActivity = useCallback(
    (phase: Activity["phase"], fileName: string, progress: number) => {
      setActivity({ phase, fileName, progress });
      setTrayProgress(phase !== "idle", progress, phase === "idle" ? "" : `${phase} ${fileName}`);
    },
    [setTrayProgress],
  );

  const analyzeFiles = useCallback(
    async (files: File[]) => {
      const acceptedFiles = files.filter((file) => file.type.startsWith("image/"));
      if (acceptedFiles.length === 0) {
        setDropHint("Only images supported");
        return;
      }

      const batchId = crypto.randomUUID();
      const createdAt = Date.now();

      for (const file of acceptedFiles) {
        const id = crypto.randomUUID();
        setItems((prev) => [
          {
            id,
            batchId,
            name: file.name,
            status: "queued",
            predictions: [],
            createdAt,
          },
          ...prev,
        ]);

        let objectUrl = "";

        try {
          updateActivity("uploading", file.name, 12);
          setItems((prev) =>
            prev.map((item) => (item.id === id ? { ...item, status: "uploading" } : item)),
          );

          objectUrl = URL.createObjectURL(file);
          const image = await loadImage(objectUrl);

          updateActivity("uploading", file.name, 45);
          await delay(120);

          updateActivity("analyzing", file.name, 62);
          setItems((prev) =>
            prev.map((item) => (item.id === id ? { ...item, status: "analyzing" } : item)),
          );

          const model = await loadModel();
          updateActivity("analyzing", file.name, 78);

          const predictions = await model.detect(image, 12, 0.45);
          updateActivity("analyzing", file.name, 96);

          setItems((prev) =>
            prev.map((item) =>
              item.id === id
                ? {
                    ...item,
                    status: "done",
                    predictions,
                    dimensions: `${image.naturalWidth}×${image.naturalHeight}`,
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
        } finally {
          if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
          }
        }
      }

      updateActivity("idle", "", 0);
      setDropHint("Drag files here...");
    },
    [loadModel, updateActivity],
  );

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
          predictions: [],
          error: "Clipboard image unavailable.",
          createdAt: Date.now(),
        },
        ...prev,
      ]);
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
    fetch("/about.md")
      .then((response) => response.text())
      .then(setAboutMarkdown)
      .catch(() => setAboutMarkdown("About file unavailable."));

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

  const latestItem = items[0];
  const statusText = activity.phase === "idle"
    ? isDragReject
      ? "Unsupported file"
      : isDragActive
        ? "Drop to analyze"
        : dropHint
    : `${capitalize(activity.phase)} ${activity.fileName}`;

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
            } ${activity.phase !== "idle" ? "dropzone-busy" : ""}`}
            {...getRootProps()}
          >
            <input {...getInputProps()} />
            <div className="dropzone-label">
              <span className="drop-icon">↥</span>
              <span>{statusText}</span>
            </div>
            <div className="drop-progress" aria-hidden="true">
              <span style={{ width: `${activity.progress}%` }} />
            </div>
          </div>

          <nav className="menu-list" aria-label="TauriSight actions">
            <MenuButton label="Select file" shortcut={selectShortcut} onClick={open} />
            <MenuButton
              label="Upload from clipboard"
              shortcut={clipboardShortcut}
              onClick={handleClipboard}
            />
            <RecentPreview item={latestItem} onOpen={() => setView("recent")} />

            <div className="separator" />

            <MenuButton
              label="Recent uploads"
              shortcut={recentShortcut}
              onClick={() => setView("recent")}
            />
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
            {items.length === 0 && <div className="empty">No processed files yet.</div>}
            {items.map((item) => (
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

          <div className="about-panel">{renderMarkdown(aboutMarkdown)}</div>
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

function RecentPreview({
  item,
  onOpen,
}: {
  item?: ProcessedItem;
  onOpen: () => void;
}) {
  return (
    <button className="recent-preview" type="button" onClick={onOpen}>
      <span className="preview-label">Latest</span>
      <span className="preview-name">{item ? item.name : "No uploads yet"}</span>
      <span className={`preview-dot ${item ? `dot-${item.status}` : ""}`} />
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
  const topPrediction = item.predictions[0];

  return (
    <article className="result-card">
      <div className="result-top">
        <div>
          <p className="file-name">{item.name}</p>
          <p className={`status status-${item.status}`}>
            {item.status === "queued" && "Queued"}
            {item.status === "uploading" && "Uploading"}
            {item.status === "analyzing" && "Analyzing"}
            {item.status === "done" &&
              `${topPrediction ? `${topPrediction.class} · ${SCORE_FORMAT.format(topPrediction.score)}` : "No object found"}${
                item.dimensions ? ` · ${item.dimensions}` : ""
              }`}
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
          {item.predictions.length === 0 && (
            <li className="muted">No confident detections.</li>
          )}
          {item.predictions.slice(0, 5).map((prediction, index) => (
            <li key={`${item.id}-${prediction.class}-${index}`}>
              <span>{prediction.class}</span>
              <span>{SCORE_FORMAT.format(prediction.score)}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function renderMarkdown(markdown: string) {
  return markdown.split("\n").map((line, index) => {
    if (line.startsWith("# ")) {
      return <h2 key={index}>{line.slice(2)}</h2>;
    }

    if (line.startsWith("## ")) {
      return <h3 key={index}>{line.slice(3)}</h3>;
    }

    if (line.startsWith("- ")) {
      return <p key={index} className="md-bullet">• {line.slice(2)}</p>;
    }

    if (!line.trim()) {
      return null;
    }

    return <p key={index}>{line}</p>;
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image decode failed."));
    image.src = src;
  });
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default App;
