import { useCallback, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type Detection = {
  label: string;
  score: number;
};

type AnalyzeResult = {
  name: string;
  detections: Detection[];
};

type ItemStatus = "processing" | "done" | "error";

type ProcessedItem = {
  id: string;
  name: string;
  status: ItemStatus;
  detections: Detection[];
  error?: string;
};

const SCORE_FORMAT = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

function App() {
  const [items, setItems] = useState<ProcessedItem[]>([]);

  const handleDrop = useCallback(async (files: File[]) => {
    for (const file of files) {
      const id = crypto.randomUUID();
      setItems((prev) => [
        {
          id,
          name: file.name,
          status: "processing",
          detections: [],
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

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: handleDrop,
    accept: { "image/*": [] },
    multiple: true,
    noClick: true,
    noKeyboard: true,
  });

  const hasItems = items.length > 0;
  const dropzoneLabel = useMemo(
    () => (isDragActive ? "Drop image here" : "Drag image here"),
    [isDragActive],
  );

  return (
    <main className="app">
      <section className="glass">
        <header className="header">
          <div>
            <p className="eyebrow">TauriSight</p>
            <h1>Vision panel</h1>
          </div>
          <button className="ghost-button" type="button" onClick={open}>
            Select file
          </button>
        </header>

        <div
          className={`dropzone ${isDragActive ? "dropzone-active" : ""}`}
          {...getRootProps()}
        >
          <input {...getInputProps()} />
          <div className="dropzone-content">
            <p className="dropzone-title">{dropzoneLabel}</p>
            <p className="dropzone-subtitle">
              Drop PNG, JPG, WEBP, or GIF. Results land below.
            </p>
          </div>
        </div>

        <section className="results">
          <div className="results-header">
            <h2>Processed</h2>
            <span className="count">{items.length}</span>
          </div>
          {!hasItems && (
            <div className="empty">No processed files yet.</div>
          )}
          {items.map((item) => (
            <article key={item.id} className="result-card">
              <div className="result-top">
                <div>
                  <p className="file-name">{item.name}</p>
                  <p className={`status status-${item.status}`}>
                    {item.status === "processing" && "Processing..."}
                    {item.status === "done" && "Ready"}
                    {item.status === "error" && "Failed"}
                  </p>
                </div>
                <button
                  type="button"
                  className="close-button"
                  onClick={() =>
                    setItems((prev) => prev.filter((entry) => entry.id !== item.id))
                  }
                  aria-label="Remove item"
                >
                  x
                </button>
              </div>

              {item.status === "error" && (
                <p className="error-text">{item.error}</p>
              )}

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
          ))}
        </section>
      </section>
    </main>
  );
}

export default App;
