import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useDropzone } from "react-dropzone";
import enTranslations from "./i18n/en.json";
import "./App.css";

type Prediction = import("@tensorflow-models/coco-ssd").DetectedObject;
type CocoModel = import("@tensorflow-models/coco-ssd").ObjectDetection;
type ItemStatus = "queued" | "uploading" | "analyzing" | "done" | "error";
type MediaKind = "image" | "video";
type View = "menu" | "recent" | "about" | "settings";
type Language = "en" | "pt";
type VideoExportType = "webm" | "mp4" | "mov";
type UpdateBanner =
  | { status: "available"; version: string }
  | { status: "installing"; version: string }
  | { status: "error"; message: string };

type ProcessedItem = {
  id: string;
  batchId: string;
  name: string;
  kind: MediaKind;
  status: ItemStatus;
  predictions: Prediction[];
  dimensions?: string;
  exportPath?: string;
  exportName?: string;
  exportExists?: boolean;
  error?: string;
  createdAt: number;
};

type Activity = {
  phase: "idle" | "uploading" | "analyzing";
  fileName: string;
  progress: number;
};

type SavedExport = {
  path: string;
  name: string;
};

type ClientSettings = {
  export_folder: string | null;
  preferred_video_export: VideoExportType;
  language: Language;
};

type Translations = typeof enTranslations;

const SCORE_FORMAT = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});
const MAX_VIDEO_SECONDS = 45;
const VIDEO_DETECT_INTERVAL_MS = 500;
const MAX_EXPORT_SIDE = 960;
const RECENT_UPLOADS_CACHE_KEY = "taurisight:recent-uploads:v1";
const MAX_CACHED_UPLOADS = 120;

const isMac = navigator.platform.toLowerCase().includes("mac");
const selectShortcut = isMac ? "⌘O" : "Ctrl+O";
const clipboardShortcut = isMac ? "⌘⇧V" : "Ctrl+Shift+V";
const recentShortcut = isMac ? "⌘Y" : "Ctrl+Y";
const quitShortcut = isMac ? "⌘Q" : "Alt+F4";

function App() {
  const [items, setItems] = useState<ProcessedItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<View>("menu");
  const [exportFolder, setExportFolder] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [videoExportType, setVideoExportType] =
    useState<VideoExportType>("webm");
  const [language, setLanguage] = useState<Language>("en");
  const [translations, setTranslations] =
    useState<Translations>(enTranslations);
  const [folderRequired, setFolderRequired] = useState(false);
  const [dropHint, setDropHint] = useState(enTranslations.dropzone.idle);
  const [updateBanner, setUpdateBanner] = useState<UpdateBanner | null>(null);
  const [updateButtonLabel, setUpdateButtonLabel] = useState<string | null>(
    null,
  );
  const [activity, setActivity] = useState<Activity>({
    phase: "idle",
    fileName: "",
    progress: 0,
  });
  const modelRef = useRef<CocoModel | null>(null);
  const updateButtonTimerRef = useRef<number | null>(null);
  const t = translations;

  const checkForUpdates = useCallback(
    async (silent = false) => {
      try {
        const update = await check();

        if (!update) {
          if (!silent) {
            if (updateButtonTimerRef.current !== null) {
              window.clearTimeout(updateButtonTimerRef.current);
            }

            setUpdateBanner(null);
            setUpdateButtonLabel(t.updates.noneFound);
            updateButtonTimerRef.current = window.setTimeout(() => {
              setUpdateButtonLabel(null);
              updateButtonTimerRef.current = null;
            }, 3000);
          }

          return;
        }

        if (updateButtonTimerRef.current !== null) {
          window.clearTimeout(updateButtonTimerRef.current);
          updateButtonTimerRef.current = null;
        }

        setUpdateButtonLabel(null);
        setUpdateBanner({ status: "available", version: update.version });
      } catch (err) {
        console.error("Updater error:", err);
        if (updateButtonTimerRef.current !== null) {
          window.clearTimeout(updateButtonTimerRef.current);
          updateButtonTimerRef.current = null;
        }

        setUpdateButtonLabel(null);
        if (!silent) {
          setUpdateBanner({ status: "error", message: t.updates.failed });
        }
      }
    },
    [t.updates.failed],
  );

  const installUpdate = useCallback(async () => {
    if (!updateBanner || updateBanner.status !== "available") {
      return;
    }

    try {
      const update = await check();
      if (!update || update.version !== updateBanner.version) {
        setUpdateBanner({ status: "error", message: t.updates.unavailable });
        return;
      }

      if (updateButtonTimerRef.current !== null) {
        window.clearTimeout(updateButtonTimerRef.current);
        updateButtonTimerRef.current = null;
      }

      setUpdateButtonLabel(null);
      setUpdateBanner({ status: "installing", version: updateBanner.version });

      await update.downloadAndInstall(() => {});
      await relaunch();
    } catch (err) {
      console.error("Updater error:", err);
      setUpdateBanner({ status: "error", message: t.updates.failed });
    }
  }, [check, t.updates.failed, t.updates.unavailable, updateBanner]);

  useEffect(() => {
    return () => {
      if (updateButtonTimerRef.current !== null) {
        window.clearTimeout(updateButtonTimerRef.current);
      }
    };
  }, []);

  const setTrayProgress = useCallback(
    (active: boolean, progress: number, label: string) => {
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;

      invoke("update_tray_progress", {
        progress: {
          active,
          progress: Math.round(progress),
          label,
          dark,
        },
      }).catch(() => {});
    },
    [],
  );

  useEffect(() => {
    setTrayProgress(false, 0, "");

    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const handleThemeChange = () => setTrayProgress(false, 0, "");

    colorScheme.addEventListener("change", handleThemeChange);
    return () => colorScheme.removeEventListener("change", handleThemeChange);
  }, [setTrayProgress]);

  const loadModel = useCallback(async () => {
    if (modelRef.current) {
      return modelRef.current;
    }

    const [tf, cocoSsd] = await Promise.all([
      import("@tensorflow/tfjs"),
      import("@tensorflow-models/coco-ssd"),
    ]);
    await Promise.all([
      import("@tensorflow/tfjs-backend-cpu"),
      import("@tensorflow/tfjs-backend-webgl"),
    ]);

    await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));
    await tf.ready();
    modelRef.current = await cocoSsd.load({ base: "lite_mobilenet_v2" });
    return modelRef.current;
  }, []);

  const updateActivity = useCallback(
    (phase: Activity["phase"], fileName: string, progress: number) => {
      setActivity({ phase, fileName, progress });
      setTrayProgress(
        phase !== "idle",
        progress,
        phase === "idle" ? "" : `${phase} ${fileName}`,
      );
    },
    [setTrayProgress],
  );

  const saveExport = useCallback(
    async (originalName: string, extension: string, blob: Blob) => {
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      return invoke<SavedExport>("save_export_file", {
        originalName,
        extension,
        bytes,
      });
    },
    [],
  );

  const analyzeFiles = useCallback(
    async (files: File[]) => {
      if (!exportFolder) {
        setFolderRequired(true);
        setDropHint(t.dropzone.needsFolder);
        return;
      }

      const acceptedFiles = files.filter(isSupportedFile);
      if (acceptedFiles.length === 0) {
        setDropHint(t.dropzone.unsupported);
        return;
      }

      setFolderRequired(false);
      const batchId = crypto.randomUUID();
      const createdAt = Date.now();

      for (const file of acceptedFiles) {
        const id = crypto.randomUUID();
        const kind = mediaKind(file);
        setItems((prev) => [
          {
            id,
            batchId,
            name: file.name,
            kind,
            status: "queued",
            predictions: [],
            createdAt,
          },
          ...prev,
        ]);
        setExpandedIds((prev) => new Set(prev).add(id));

        let objectUrl = "";

        try {
          updateActivity("uploading", file.name, 10);
          setItems((prev) =>
            prev.map((item) =>
              item.id === id ? { ...item, status: "uploading" } : item,
            ),
          );

          objectUrl = URL.createObjectURL(file);
          await delay(80);

          updateActivity("analyzing", file.name, 35);
          setItems((prev) =>
            prev.map((item) =>
              item.id === id ? { ...item, status: "analyzing" } : item,
            ),
          );

          const model = await loadModel();
          const result =
            kind === "image"
              ? await analyzeImage(
                  file,
                  objectUrl,
                  model,
                  saveExport,
                  (progress) =>
                    updateActivity("analyzing", file.name, progress),
                  t,
                )
              : await analyzeVideo(
                  file,
                  objectUrl,
                  model,
                  saveExport,
                  (progress) =>
                    updateActivity("analyzing", file.name, progress),
                  videoExportType,
                  t,
                );

          setItems((prev) =>
            prev.map((item) =>
              item.id === id
                ? {
                    ...item,
                    status: "done",
                    predictions: result.predictions,
                    dimensions: result.dimensions,
                    exportPath: result.exportPath,
                    exportName: result.exportName,
                    exportExists: true,
                  }
                : item,
            ),
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : t.errors.mediaFailed;
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
      setDropHint(t.dropzone.idle);
    },
    [
      exportFolder,
      loadModel,
      saveExport,
      t.dropzone.idle,
      t.dropzone.needsFolder,
      t.dropzone.unsupported,
      updateActivity,
      videoExportType,
    ],
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
        files.push(
          new File([blob], `clipboard-image.${extension}`, { type: imageType }),
        );
      }

      await analyzeFiles(files);
    } catch {
      const id = crypto.randomUUID();
      setItems((prev) => [
        {
          id,
          batchId: id,
          name: "Clipboard",
          kind: "image",
          status: "error",
          predictions: [],
          error: t.errors.clipboardUnavailable,
          createdAt: Date.now(),
        },
        ...prev,
      ]);
    }
  }, [analyzeFiles]);

  const chooseExportFolder = useCallback(async () => {
    const folder = await invoke<string | null>("choose_export_folder");
    if (folder) {
      setExportFolder(folder);
      setFolderRequired(false);
      setDropHint(t.dropzone.idle);
    }
  }, [t.dropzone.idle]);

  const updatePreference = useCallback(
    async (nextVideoExport: VideoExportType, nextLanguage: Language) => {
      const settings = await invoke<ClientSettings>("update_preferences", {
        preferredVideoExport: nextVideoExport,
        language: nextLanguage,
      });
      setVideoExportType(settings.preferred_video_export);
      setLanguage(settings.language);
    },
    [],
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((entry) => entry.id !== id));
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const revealExport = useCallback(async (item: ProcessedItem) => {
    if (!item.exportPath) {
      return;
    }

    const exists = await invoke<boolean>("export_file_exists", {
      path: item.exportPath,
    }).catch(() => false);
    setItems((prev) =>
      prev.map((entry) =>
        entry.id === item.id ? { ...entry, exportExists: exists } : entry,
      ),
    );
    if (exists) {
      invoke("reveal_exported_file", { path: item.exportPath }).catch(() => {});
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive, isDragReject, open } =
    useDropzone({
      onDrop: analyzeFiles,
      onDragEnter: () =>
        setDropHint(exportFolder ? t.dropzone.release : t.dropzone.needsFolder),
      onDragLeave: () =>
        setDropHint(exportFolder ? t.dropzone.idle : t.dropzone.needsFolder),
      accept: {
        "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif"],
        "video/mp4": [".mp4", ".m4v"],
        "video/quicktime": [".mov"],
      },
      multiple: true,
      noClick: true,
      noKeyboard: true,
    });

  useEffect(() => {
    invoke<ClientSettings>("get_settings")
      .then((settings) => {
        setExportFolder(settings.export_folder);
        setVideoExportType(settings.preferred_video_export);
        setLanguage(settings.language);
        if (!settings.export_folder) {
          if (settings.language === "pt") {
            import("./i18n/pt.json")
              .then((module) =>
                setDropHint(module.default.dropzone.needsFolder),
              )
              .catch(() => setDropHint(enTranslations.dropzone.needsFolder));
          } else {
            setDropHint(enTranslations.dropzone.needsFolder);
          }
        }
        setSettingsLoaded(true);
      })
      .catch(() => {
        setSettingsLoaded(true);
        setDropHint(enTranslations.dropzone.needsFolder);
      });
  }, []);

  useEffect(() => {
    if (language === "en") {
      setTranslations(enTranslations);
      return;
    }

    import("./i18n/pt.json")
      .then((module) => setTranslations(module.default))
      .catch(() => setTranslations(enTranslations));
  }, [language]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RECENT_UPLOADS_CACHE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }

      const restored = parsed
        .map(restoreCachedItem)
        .filter((item): item is ProcessedItem => item !== null)
        .sort((left, right) => right.createdAt - left.createdAt);

      if (restored.length > 0) {
        setItems(restored);
      }
    } catch {
      // Ignore broken cache entries and continue with empty list.
    }
  }, []);

  useEffect(() => {
    try {
      const cacheable = items
        .filter((item) => item.status === "done" || item.status === "error")
        .slice(0, MAX_CACHED_UPLOADS)
        .map(toCachedItem);

      window.localStorage.setItem(
        RECENT_UPLOADS_CACHE_KEY,
        JSON.stringify(cacheable),
      );
    } catch {
      // Ignore persistence failures in restricted environments.
    }
  }, [items]);

  // Ensure dropzone hint uses current translations on initial load
  // without overwriting transient hints while uploading/dragging.
  useEffect(() => {
    if (activity.phase !== "idle") return;

    const needsExport = settingsLoaded && !exportFolder;
    if (folderRequired || needsExport) {
      setDropHint(translations.dropzone.needsFolder);
      return;
    }

    setDropHint(translations.dropzone.idle);
  }, [
    translations,
    activity.phase,
    folderRequired,
    settingsLoaded,
    exportFolder,
  ]);

  useEffect(() => {
    checkForUpdates(true);
  }, [checkForUpdates]);

  useEffect(() => {
    const paths = items
      .filter((item) => item.exportPath)
      .map((item) => item.exportPath as string);
    if (paths.length === 0) {
      return;
    }

    let cancelled = false;
    Promise.all(
      items
        .filter((item) => item.exportPath)
        .map(async (item) => ({
          id: item.id,
          exists: await invoke<boolean>("export_file_exists", {
            path: item.exportPath,
          }).catch(() => false),
        })),
    ).then((checks) => {
      if (cancelled) {
        return;
      }
      setItems((prev) =>
        prev.map((item) => {
          const check = checks.find((entry) => entry.id === item.id);
          return check ? { ...item, exportExists: check.exists } : item;
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [items.length, view]);

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

      if (mod && key === ",") {
        event.preventDefault();
        setView("settings");
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
    const listeners = [
      listen("show-about", () => setView("about")),
      listen("show-settings", () => setView("settings")),
      listen("show-recent", () => setView("recent")),
      listen("open-file-picker", () => open()),
      listen("upload-from-clipboard", () => handleClipboard()),
    ];

    return () => {
      listeners.forEach((listener) => listener.then((stop) => stop()));
    };
  }, [handleClipboard, open]);

  const latestItem = items[0];
  const needsExportFolder = settingsLoaded && !exportFolder;
  const statusText =
    activity.phase === "idle"
      ? folderRequired || needsExportFolder
        ? t.dropzone.needsFolder
        : isDragReject
          ? t.dropzone.unsupported
          : isDragActive
            ? t.dropzone.drop
            : dropHint
      : `${activity.phase === "uploading" ? t.dropzone.uploading : t.dropzone.analyzing} ${
          activity.fileName
        }`;

  return (
    <main className="app">
      {view !== "menu" && (
        <button
          className="back-button"
          type="button"
          onClick={() => setView("menu")}
        >
          ‹
        </button>
      )}

      {view === "menu" && (
        <>
          <div
            className={`dropzone ${isDragActive ? "dropzone-active" : ""} ${
              isDragReject ? "dropzone-reject" : ""
            } ${folderRequired || needsExportFolder ? "dropzone-needs-folder" : ""} ${
              activity.phase !== "idle" ? "dropzone-busy" : ""
            }`}
            {...getRootProps()}
          >
            <input {...getInputProps()} />
            <div className="dropzone-label">
              <span className="drop-icon">{needsExportFolder ? "!" : "↥"}</span>
              <span>{statusText}</span>
            </div>
            <div className="drop-progress" aria-hidden="true">
              <span style={{ width: `${activity.progress}%` }} />
            </div>
          </div>

          <nav className="menu-list" aria-label="TauriSight actions">
            <MenuButton
              label={t.menu.selectFile}
              shortcut={selectShortcut}
              onClick={open}
            />
            <MenuButton
              label={t.menu.clipboard}
              shortcut={clipboardShortcut}
              onClick={handleClipboard}
            />

            <MenuButton
              label={t.menu.recents}
              shortcut={recentShortcut}
              onClick={() => setView("recent")}
            />

            <div className="separator" />

            <RecentPreview
              item={latestItem}
              onOpen={() => setView("recent")}
              t={t}
            />

            <div className="separator" />

            <MenuButton label={t.menu.about} onClick={() => setView("about")} />
            <MenuButton
              label={
                updateButtonLabel ??
                (updateBanner
                  ? updateBanner.status === "available"
                    ? t.updates.available.replace(
                        "{version}",
                        updateBanner.version,
                      )
                    : updateBanner.status === "installing"
                      ? t.updates.installing.replace(
                          "{version}",
                          updateBanner.version,
                        )
                      : updateBanner.message
                  : t.menu.updates)
              }
              onClick={() => {
                if (updateBanner?.status === "available") {
                  void installUpdate();
                  return;
                }

                if (!updateBanner || updateBanner.status === "error") {
                  void checkForUpdates(false);
                }
              }}
              disabled={updateBanner?.status === "installing"}
              trailing={
                updateBanner ? (
                  <span className="update-actions">
                    {updateBanner.status === "available" && (
                      <button
                        className="update-action"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void installUpdate();
                        }}
                        aria-label={t.updates.install}
                      >
                        ✓
                      </button>
                    )}
                    <button
                      className="update-action"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setUpdateBanner(null);
                      }}
                      aria-label={t.updates.dismiss}
                    >
                      ×
                    </button>
                  </span>
                ) : null
              }
            />
            <div className="separator" />

            <MenuButton
              label={t.menu.settings}
              shortcut={isMac ? "⌘," : "Ctrl+,"}
              warning={needsExportFolder}
              onClick={() => setView("settings")}
            />
            <MenuButton
              label={t.menu.quit}
              shortcut={quitShortcut}
              onClick={() => invoke("quit_app")}
            />
          </nav>
        </>
      )}

      {view === "recent" && (
        <section className="panel">
          <header className="panel-header">
            <div>
              <p className="eyebrow">TauriSight</p>
              <h1>{t.recents.title}</h1>
            </div>
            <span className="count">{items.length}</span>
          </header>

          <div className="results">
            {items.length === 0 && (
              <div className="empty">{t.recents.empty}</div>
            )}
            {items.map((item) => (
              <ResultCard
                key={item.id}
                expanded={expandedIds.has(item.id)}
                item={item}
                onRemove={removeItem}
                onReveal={revealExport}
                onToggle={toggleExpanded}
                t={t}
              />
            ))}
          </div>
        </section>
      )}

      {view === "settings" && (
        <SettingsPanel
          exportFolder={exportFolder}
          needsExportFolder={needsExportFolder}
          videoExportType={videoExportType}
          language={language}
          onChooseFolder={chooseExportFolder}
          onPreferenceChange={updatePreference}
          t={t}
        />
      )}

      {view === "about" && <AboutPanel t={t} />}
    </main>
  );
}

function AboutPanel({ t }: { t: Translations }) {
  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">TauriSight</p>
          <h1>{t.about.title}</h1>
        </div>
      </header>

      <div className="about-panel">
        <p>{t.about.summary}</p>
        <p>
          {t.about.madeByPrefix}{" "}
          <button
            className="text-link"
            type="button"
            onClick={() => openUrl(t.about.links.siteUrl)}
          >
            {t.about.links.siteLabel}
          </button>
          .
        </p>

        <h2>{t.about.modelTitle}</h2>
        <p>
          <button
            className="text-link"
            type="button"
            onClick={() => openUrl(t.about.links.modelUrl)}
          >
            {t.about.links.modelLabel}
          </button>{" "}
          {t.about.modelBody}
        </p>

        <h2>{t.about.workflowTitle}</h2>
        <ul className="about-list">
          {t.about.workflowItems.map((item, index) => (
            <li key={`workflow-${index}`}>{item}</li>
          ))}
        </ul>

        <h2>{t.about.notesTitle}</h2>
        <ul className="about-list">
          {t.about.noteItems.map((item, index) => (
            <li key={`notes-${index}`}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function MenuButton({
  label,
  shortcut,
  disabled,
  warning,
  trailing,
  onClick,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  warning?: boolean;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className="menu-row">
      <button
        className="menu-item"
        type="button"
        disabled={disabled}
        onClick={onClick}
      >
        <span className="menu-label">
          {warning && <span className="warn-badge">!</span>}
          {label}
        </span>
        {!trailing && shortcut && <kbd>{shortcut}</kbd>}
      </button>
      {trailing && <div className="menu-trailing">{trailing}</div>}
    </div>
  );
}

function RecentPreview({
  item,
  onOpen,
  t,
}: {
  item?: ProcessedItem;
  onOpen: () => void;
  t: Translations;
}) {
  return (
    <button className="recent-preview" type="button" onClick={onOpen}>
      <span className="preview-label">{t.recents.latest}</span>
      <span className="preview-name">
        {item ? item.name : t.recents.noUploads}
      </span>
      <span className={`preview-dot ${item ? `dot-${item.status}` : ""}`} />
    </button>
  );
}

function SettingsPanel({
  exportFolder,
  needsExportFolder,
  videoExportType,
  language,
  onChooseFolder,
  onPreferenceChange,
  t,
}: {
  exportFolder: string | null;
  needsExportFolder: boolean;
  videoExportType: VideoExportType;
  language: Language;
  onChooseFolder: () => void;
  onPreferenceChange: (
    videoExportType: VideoExportType,
    language: Language,
  ) => void;
  t: Translations;
}) {
  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">TauriSight</p>
          <h1>{t.settings.title}</h1>
        </div>
        {needsExportFolder && <span className="warn-badge large">!</span>}
      </header>

      <div className="settings-panel">
        <div
          className={`setting-row ${needsExportFolder ? "setting-required" : ""}`}
        >
          <div>
            <p className="setting-title">{t.settings.exportFolder}</p>
            <p className="setting-value">
              {exportFolder ?? t.settings.required}
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={onChooseFolder}
          >
            {t.settings.choose}
          </button>
        </div>
        <label className="setting-row">
          <div>
            <p className="setting-title">{t.settings.videoExport}</p>
            <p className="setting-value">{t.settings.videoNote}</p>
          </div>
          <select
            className="select-control"
            value={videoExportType}
            onChange={(event) =>
              onPreferenceChange(
                event.currentTarget.value as VideoExportType,
                language,
              )
            }
          >
            <option value="webm">WebM</option>
            <option value="mp4">MP4</option>
            <option value="mov">MOV</option>
          </select>
        </label>
        <label className="setting-row">
          <div>
            <p className="setting-title">{t.settings.language}</p>
            <p className="setting-value">
              {language === "pt" ? t.settings.portuguese : t.settings.english}
            </p>
          </div>
          <select
            className="select-control"
            value={language}
            onChange={(event) =>
              onPreferenceChange(
                videoExportType,
                event.currentTarget.value as Language,
              )
            }
          >
            <option value="en">{t.settings.english}</option>
            <option value="pt">{t.settings.portuguese}</option>
          </select>
        </label>
      </div>
    </section>
  );
}

function ResultCard({
  item,
  expanded,
  onRemove,
  onReveal,
  onToggle,
  t,
}: {
  item: ProcessedItem;
  expanded: boolean;
  onRemove: (id: string) => void;
  onReveal: (item: ProcessedItem) => void;
  onToggle: (id: string) => void;
  t: Translations;
}) {
  const topPrediction = item.predictions[0];

  return (
    <article className="result-card">
      <div className="result-top">
        <button
          className={`expand-button ${expanded ? "expanded" : ""}`}
          type="button"
          onClick={() => onToggle(item.id)}
          aria-label={expanded ? t.recents.collapse : t.recents.expand}
        >
          ›
        </button>
        <div className="media-thumb" aria-hidden="true">
          {item.kind === "image" ? "▧" : "▶"}
        </div>
        <div className="result-copy">
          <p className="file-name">{item.name}</p>
          <p className={`status status-${item.status}`}>
            {item.status === "queued" && t.status.queued}
            {item.status === "uploading" && t.status.uploading}
            {item.status === "analyzing" && t.status.analyzing}
            {item.status === "done" &&
              `${topPrediction ? `${topPrediction.class} · ${SCORE_FORMAT.format(topPrediction.score)}` : t.status.noObject}${
                item.dimensions ? ` · ${item.dimensions}` : ""
              }`}
            {item.status === "error" && t.status.failed}
          </p>
        </div>
        <div className="result-actions">
          <button
            type="button"
            className="icon-button"
            disabled={!item.exportPath || item.exportExists === false}
            onClick={() => onReveal(item)}
            aria-label={t.recents.reveal}
          >
            ⌕
          </button>
          <button
            type="button"
            className="close-button"
            onClick={() => onRemove(item.id)}
            aria-label={t.recents.remove}
          >
            ×
          </button>
        </div>
      </div>

      {expanded && (
        <div className="result-details">
          {item.status === "error" && (
            <p className="error-text">{item.error}</p>
          )}
          {item.exportName && (
            <p
              className={`export-text ${item.exportExists === false ? "missing" : ""}`}
            >
              {item.exportExists === false
                ? t.recents.missingExport
                : `${t.recents.exported}: ${item.exportName}`}
            </p>
          )}

          {item.status === "done" && (
            <ul className="detections">
              {item.predictions.length === 0 && (
                <li className="muted">{t.recents.noDetections}</li>
              )}
              {item.predictions.slice(0, 8).map((prediction, index) => (
                <li key={`${item.id}-${prediction.class}-${index}`}>
                  <span>{prediction.class}</span>
                  <span>{SCORE_FORMAT.format(prediction.score)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

async function analyzeImage(
  file: File,
  objectUrl: string,
  model: CocoModel,
  saveExport: (
    originalName: string,
    extension: string,
    blob: Blob,
  ) => Promise<SavedExport>,
  setProgress: (progress: number) => void,
  t: Translations,
) {
  const image = await loadImage(objectUrl, t);
  setProgress(62);
  const predictions = await model.detect(image, 16, 0.45);
  setProgress(82);

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = mustContext(canvas, t);
  context.drawImage(image, 0, 0);
  drawDetections(context, predictions, 1, 1);

  const blob = await canvasToBlob(canvas, "image/png", t);
  const saved = await saveExport(file.name, "png", blob);
  setProgress(98);

  return {
    predictions,
    dimensions: `${image.naturalWidth}×${image.naturalHeight}`,
    exportPath: saved.path,
    exportName: saved.name,
  };
}

async function analyzeVideo(
  file: File,
  objectUrl: string,
  model: CocoModel,
  saveExport: (
    originalName: string,
    extension: string,
    blob: Blob,
  ) => Promise<SavedExport>,
  setProgress: (progress: number) => void,
  exportType: VideoExportType,
  t: Translations,
) {
  const video = await loadVideo(objectUrl, t);
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error(t.errors.videoDuration);
  }
  if (video.duration > MAX_VIDEO_SECONDS) {
    throw new Error(
      t.errors.videoTooLong.replace("{seconds}", String(MAX_VIDEO_SECONDS)),
    );
  }

  const { width, height } = fitSize(
    video.videoWidth,
    video.videoHeight,
    MAX_EXPORT_SIDE,
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = mustContext(canvas, t);
  if (!("MediaRecorder" in window)) {
    throw new Error(t.errors.videoExportUnavailable);
  }

  const stream = canvas.captureStream(24);
  const mimeType = preferredVideoMimeType(exportType);
  if (!mimeType) {
    throw new Error(
      t.errors.videoFormatUnavailable.replace(
        "{format}",
        exportType.toUpperCase(),
      ),
    );
  }
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  const allPredictions: Prediction[] = [];
  let predictions: Prediction[] = [];
  let lastDetectAt = 0;
  let detecting = false;

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () =>
      resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
  });

  recorder.start(500);
  video.currentTime = 0;
  video.muted = true;
  await video.play();

  await new Promise<void>((resolve) => {
    const draw = () => {
      context.drawImage(video, 0, 0, width, height);
      drawDetections(
        context,
        predictions,
        width / video.videoWidth,
        height / video.videoHeight,
      );
      setProgress(45 + Math.min(45, (video.currentTime / video.duration) * 45));

      const now = performance.now();
      if (!detecting && now - lastDetectAt > VIDEO_DETECT_INTERVAL_MS) {
        detecting = true;
        lastDetectAt = now;
        model
          .detect(video, 12, 0.45)
          .then((next) => {
            predictions = next;
            allPredictions.push(...next.slice(0, 3));
          })
          .finally(() => {
            detecting = false;
          });
      }

      if (video.ended || video.currentTime >= video.duration) {
        resolve();
        return;
      }

      requestAnimationFrame(draw);
    };

    draw();
  });

  recorder.stop();
  const blob = await stopped;
  const saved = await saveExport(file.name, exportType, blob);
  setProgress(98);

  return {
    predictions: dedupePredictions(allPredictions),
    dimensions: `${video.videoWidth}×${video.videoHeight}`,
    exportPath: saved.path,
    exportName: saved.name,
  };
}

function drawDetections(
  context: CanvasRenderingContext2D,
  predictions: Prediction[],
  scaleX: number,
  scaleY: number,
) {
  context.save();
  context.lineWidth = 3;
  context.font =
    "600 14px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";

  for (const prediction of predictions) {
    const [x, y, width, height] = prediction.bbox;
    const left = x * scaleX;
    const top = y * scaleY;
    const boxWidth = width * scaleX;
    const boxHeight = height * scaleY;
    const label = `${prediction.class} ${SCORE_FORMAT.format(prediction.score)}`;
    const labelWidth = context.measureText(label).width + 12;
    const labelY = Math.max(0, top - 24);

    context.strokeStyle = "rgba(117, 218, 166, 0.95)";
    context.fillStyle = "rgba(15, 17, 22, 0.82)";
    context.strokeRect(left, top, boxWidth, boxHeight);
    context.fillRect(left, labelY, labelWidth, 22);
    context.fillStyle = "#f6f7f9";
    context.fillText(label, left + 6, labelY + 15);
  }

  context.restore();
}

function dedupePredictions(predictions: Prediction[]) {
  const best = new Map<string, Prediction>();
  for (const prediction of predictions) {
    const current = best.get(prediction.class);
    if (!current || prediction.score > current.score) {
      best.set(prediction.class, prediction);
    }
  }

  return Array.from(best.values()).sort(
    (left, right) => right.score - left.score,
  );
}

function isSupportedFile(file: File) {
  return file.type.startsWith("image/") || /\.(mp4|m4v|mov)$/i.test(file.name);
}

function mediaKind(file: File): MediaKind {
  return file.type.startsWith("image/") ? "image" : "video";
}

function fitSize(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function preferredVideoMimeType(exportType: VideoExportType) {
  const options: Record<VideoExportType, string[]> = {
    webm: ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
    mp4: ["video/mp4;codecs=avc1.42E01E", "video/mp4"],
    mov: ["video/quicktime"],
  };
  const types = options[exportType];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function mustContext(canvas: HTMLCanvasElement, t: Translations) {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error(t.errors.canvasUnavailable);
  }

  return context;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  t: Translations,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error(t.errors.exportRenderFailed));
      }
    }, type);
  });
}

function loadImage(src: string, t: Translations) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(t.errors.imageDecodeFailed));
    image.src = src;
  });
}

function loadVideo(src: string, t: Translations) {
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.playsInline = true;
    video.muted = true;
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => {
      const code = video.error?.code;
      const suffix = code ? ` (code ${code})` : "";
      reject(new Error(`${t.errors.videoDecodeFailed}${suffix}`));
    };
    video.src = src;
    video.load();
  });
}

function toCachedItem(item: ProcessedItem) {
  return {
    id: item.id,
    batchId: item.batchId,
    name: item.name,
    kind: item.kind,
    status: item.status,
    predictions: item.predictions.map((prediction) => ({
      class: prediction.class,
      score: prediction.score,
      bbox: prediction.bbox,
    })),
    dimensions: item.dimensions,
    exportPath: item.exportPath,
    exportName: item.exportName,
    exportExists: item.exportExists,
    error: item.error,
    createdAt: item.createdAt,
  };
}

function restoreCachedItem(input: unknown): ProcessedItem | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<ProcessedItem>;
  if (!candidate.id || !candidate.name || !candidate.batchId) {
    return null;
  }

  const predictions = Array.isArray(candidate.predictions)
    ? candidate.predictions.filter(
        (prediction): prediction is Prediction =>
          typeof prediction === "object" &&
          prediction !== null &&
          typeof prediction.class === "string" &&
          typeof prediction.score === "number" &&
          Array.isArray(prediction.bbox),
      )
    : [];

  const status: ItemStatus =
    candidate.status === "done" || candidate.status === "error"
      ? candidate.status
      : "error";

  return {
    id: candidate.id,
    batchId: candidate.batchId,
    name: candidate.name,
    kind: candidate.kind === "video" ? "video" : "image",
    status,
    predictions,
    dimensions:
      typeof candidate.dimensions === "string"
        ? candidate.dimensions
        : undefined,
    exportPath:
      typeof candidate.exportPath === "string"
        ? candidate.exportPath
        : undefined,
    exportName:
      typeof candidate.exportName === "string"
        ? candidate.exportName
        : undefined,
    exportExists:
      typeof candidate.exportExists === "boolean"
        ? candidate.exportExists
        : undefined,
    error: typeof candidate.error === "string" ? candidate.error : undefined,
    createdAt:
      typeof candidate.createdAt === "number"
        ? candidate.createdAt
        : Date.now(),
  };
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default App;
