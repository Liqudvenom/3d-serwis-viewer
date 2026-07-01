"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArcRotateCamera,
  Color3,
  Color4,
  Engine,
  GlowLayer,
  HemisphericLight,
  Material,
  Mesh,
  PBRMaterial,
  Scene,
  SceneLoader,
  Tools,
  Vector3,
} from "@babylonjs/core";
import "@babylonjs/core/Helpers/sceneHelpers";
import "@babylonjs/loaders";

type ModelViewerProps = {
  className?: string;
  showDebug?: boolean;
};

type ModelMetrics = {
  totalVertices: number;
  isWatertight: boolean;
  complexityScore: number;
};

type FolderFile = {
  relativePath: string;
  file: File;
};

type DirectoryPickerHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
};

type PreparedModelLoad = {
  rootUrl: string;
  sceneFilename: string;
  blobUrls: string[];
};

type GltfJson = {
  buffers?: Array<{ uri?: string }>;
  images?: Array<{ uri?: string }>;
};

function normalizeRelativePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function getDirectoryPath(relativePath: string) {
  const normalized = normalizeRelativePath(relativePath);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? "" : normalized.slice(0, lastSlash + 1);
}

function resolveRelativePath(baseDir: string, uri: string) {
  const parts = `${baseDir}${uri}`.split("/");
  const stack: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      stack.pop();
      continue;
    }

    stack.push(part);
  }

  return stack.join("/");
}

function debounce(callback: () => void, delay = 150) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const debounced = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(callback, delay);
  };

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  };

  return debounced;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitForIdle(timeout = 600) {
  return new Promise<void>((resolve) => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    };

    if (idleWindow.requestIdleCallback) {
      idleWindow.requestIdleCallback(() => resolve(), { timeout });
      return;
    }

    window.setTimeout(resolve, 1);
  });
}

function analyzeModel(meshes: Mesh[]): ModelMetrics {
  const totalVertices = meshes.reduce((total, mesh) => total + mesh.getTotalVertices(), 0);
  const totalSubMeshes = meshes.reduce((total, mesh) => total + (mesh.subMeshes?.length ?? 0), 0);
  const isWatertight = totalSubMeshes > 0 && totalSubMeshes % 2 === 0;
  const complexityScore = Math.min(100, Math.round(Math.log10(totalVertices + 1) * 20));

  return {
    totalVertices,
    isWatertight,
    complexityScore,
  };
}

function animateCameraTo(scene: Scene, camera: ArcRotateCamera, target: Vector3, radius: number) {
  const startTarget = camera.target.clone();
  const startRadius = camera.radius;
  const startTime = performance.now();
  const duration = 450;

  const observer = scene.onBeforeRenderObservable.add(() => {
    const progress = Math.min((performance.now() - startTime) / duration, 1);
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    const nextTarget = Vector3.Lerp(startTarget, target, easedProgress);

    camera.setTarget(nextTarget);
    camera.radius = startRadius + (radius - startRadius) * easedProgress;

    if (progress >= 1) {
      camera.setTarget(target);
      camera.radius = radius;
      scene.onBeforeRenderObservable.remove(observer);
    }
  });
}

function isModelFile(path: string) {
  const lower = path.toLowerCase();
  return lower.endsWith(".glb") || lower.endsWith(".gltf");
}

function collectFilesFromFileList(fileList: FileList) {
  const files: FolderFile[] = [];

  for (const file of Array.from(fileList)) {
    const relativePath = normalizeRelativePath(file.webkitRelativePath || file.name);
    files.push({ relativePath, file });
  }

  return files;
}

async function readDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  currentPath = "",
): Promise<FolderFile[]> {
  const files: FolderFile[] = [];
  const directoryHandle = handle as DirectoryPickerHandle;

  for await (const entry of directoryHandle.values()) {
    const relativePath = `${currentPath}${entry.name}`;

    if (entry.kind === "file") {
      files.push({
        relativePath,
        file: await (entry as FileSystemFileHandle).getFile(),
      });
      continue;
    }

    files.push(...(await readDirectoryHandle(entry as FileSystemDirectoryHandle, `${relativePath}/`)));
  }

  return files;
}

async function traverseFileTreeEntry(entry: FileSystemEntry, currentPath = ""): Promise<FolderFile[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });

    return [
      {
        relativePath: normalizeRelativePath(`${currentPath}${file.name}`),
        file,
      },
    ];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const directoryEntry = entry as FileSystemDirectoryEntry;
  const directoryReader = directoryEntry.createReader();
  const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
    directoryReader.readEntries(resolve, reject);
  });

  const nested = await Promise.all(
    entries.map((childEntry) => traverseFileTreeEntry(childEntry, `${currentPath}${entry.name}/`)),
  );

  return nested.flat();
}

async function collectFilesFromDataTransfer(dataTransfer: DataTransfer) {
  const items = Array.from(dataTransfer.items);
  const entries = items
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);

  if (entries.length === 0) {
    return collectFilesFromFileList(dataTransfer.files);
  }

  const hasDirectory = entries.some((entry) => entry.isDirectory);

  if (!hasDirectory) {
    const files = entries.filter((entry) => entry.isFile);
    const modelEntries = files.filter((entry) => isModelFile(entry.name));

    if (modelEntries.length === 1 && files.length === 1) {
      return traverseFileTreeEntry(modelEntries[0]);
    }
  }

  const nested = await Promise.all(entries.map((entry) => traverseFileTreeEntry(entry)));
  return nested.flat();
}

function findMainModelFile(files: FolderFile[]) {
  const modelFiles = files.filter((item) => isModelFile(item.relativePath));

  if (modelFiles.length === 0) {
    return {
      error: "Nie znaleziono pliku .glb ani .gltf w wybranym folderze.",
      modelFile: null,
    };
  }

  if (modelFiles.length > 1) {
    return {
      error: "Znaleziono wiele plików modelu. Wybierz folder z jednym plikiem .glb lub .gltf.",
      modelFile: null,
    };
  }

  return {
    error: null,
    modelFile: modelFiles[0],
  };
}

function buildPathToBlobUrlMap(files: FolderFile[]) {
  const map = new Map<string, string>();
  const blobUrls: string[] = [];

  for (const item of files) {
    const normalizedPath = normalizeRelativePath(item.relativePath);
    const blobUrl = URL.createObjectURL(item.file);
    map.set(normalizedPath, blobUrl);
    blobUrls.push(blobUrl);
  }

  return { map, blobUrls };
}

function patchGltfJson(gltf: GltfJson, gltfRelativePath: string, pathToBlobUrl: Map<string, string>) {
  const gltfDir = getDirectoryPath(gltfRelativePath);

  const patchUri = (uri: string) => {
    if (uri.startsWith("data:")) {
      return uri;
    }

    const resolvedPath = resolveRelativePath(gltfDir, uri);
    const blobUrl = pathToBlobUrl.get(resolvedPath);

    if (!blobUrl) {
      throw new Error(`Brak pliku powiązanego z modelem: ${uri}`);
    }

    return blobUrl;
  };

  gltf.buffers?.forEach((buffer) => {
    if (buffer.uri) {
      buffer.uri = patchUri(buffer.uri);
    }
  });

  gltf.images?.forEach((image) => {
    if (image.uri) {
      image.uri = patchUri(image.uri);
    }
  });

  return gltf;
}

async function prepareModelLoad(files: FolderFile[]): Promise<PreparedModelLoad> {
  const { error, modelFile } = findMainModelFile(files);

  if (error || !modelFile) {
    throw new Error(error ?? "Nie udało się przygotować modelu do wczytania.");
  }

  const { map, blobUrls } = buildPathToBlobUrlMap(files);
  const lowerPath = modelFile.relativePath.toLowerCase();

  if (lowerPath.endsWith(".glb")) {
    const blobUrl = map.get(normalizeRelativePath(modelFile.relativePath));

    if (!blobUrl) {
      throw new Error("Nie udało się utworzyć adresu dla pliku modelu.");
    }

    return {
      rootUrl: "",
      sceneFilename: blobUrl,
      blobUrls,
    };
  }

  const gltfText = await modelFile.file.text();
  const gltfJson = JSON.parse(gltfText) as GltfJson;
  const patchedJson = patchGltfJson(gltfJson, modelFile.relativePath, map);
  const patchedBlob = new Blob([JSON.stringify(patchedJson)], { type: "model/gltf+json" });
  const patchedBlobUrl = URL.createObjectURL(patchedBlob);

  return {
    rootUrl: "",
    sceneFilename: patchedBlobUrl,
    blobUrls: [...blobUrls, patchedBlobUrl],
  };
}

export default function ModelViewer({ className, showDebug = false }: ModelViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const cameraRef = useRef<ArcRotateCamera | null>(null);
  const glowLayerRef = useRef<GlowLayer | null>(null);
  const materialRef = useRef<PBRMaterial | null>(null);
  const currentMeshesRef = useRef<Mesh[]>([]);
  const originalMaterialsRef = useRef<Map<Mesh, Material | null>>(new Map());
  const blobUrlsRef = useRef<string[]>([]);
  const loadRequestIdRef = useRef(0);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isFading, setIsFading] = useState(false);
  const [hasTexture, setHasTexture] = useState(false);
  const [hasModel, setHasModel] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [panelMessage, setPanelMessage] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [loadedModelName, setLoadedModelName] = useState<string | null>(null);
  const [fps, setFps] = useState("0");
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const numberFormatter = useMemo(() => new Intl.NumberFormat("pl-PL"), []);

  const revokeBlobUrls = useCallback(() => {
    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];
  }, []);

  const clearSceneMeshes = useCallback(() => {
    const scene = sceneRef.current;
    const glowLayer = glowLayerRef.current;

    if (!scene || !glowLayer) {
      return;
    }

    currentMeshesRef.current.forEach((mesh) => {
      glowLayer.removeIncludedOnlyMesh(mesh);
      mesh.dispose(true, false);
    });

    currentMeshesRef.current = [];
    originalMaterialsRef.current.clear();
  }, []);

  const applyTextureMode = useCallback((useTexture: boolean) => {
    const viewerMaterial = materialRef.current;

    if (!viewerMaterial) {
      return;
    }

    currentMeshesRef.current.forEach((mesh) => {
      if (!(mesh instanceof Mesh) || mesh.getTotalVertices() === 0) {
        return;
      }

      mesh.material = useTexture
        ? (originalMaterialsRef.current.get(mesh) ?? null)
        : viewerMaterial;
    });
  }, []);

  const loadModelFromFolder = useCallback(
    async (files: FolderFile[]) => {
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const glowLayer = glowLayerRef.current;
      const viewerMaterial = materialRef.current;

      if (!scene || !camera || !glowLayer || !viewerMaterial) {
        return;
      }

      if (files.length === 0) {
        setPanelMessage("Wybrany folder jest pusty.");
        return;
      }

      const requestId = loadRequestIdRef.current + 1;
      loadRequestIdRef.current = requestId;
      setIsLoading(true);
      setIsFading(true);
      setErrorMessage(null);
      setPanelMessage(null);
      setMetrics(null);

      await wait(180);

      if (requestId !== loadRequestIdRef.current) {
        return;
      }

      try {
        const preparedLoad = await prepareModelLoad(files);

        if (requestId !== loadRequestIdRef.current) {
          preparedLoad.blobUrls.forEach((url) => URL.revokeObjectURL(url));
          return;
        }

        revokeBlobUrls();
        blobUrlsRef.current = preparedLoad.blobUrls;

        await waitForIdle();

        if (requestId !== loadRequestIdRef.current) {
          return;
        }

        clearSceneMeshes();

        const result = await SceneLoader.ImportMeshAsync(
          "",
          preparedLoad.rootUrl,
          preparedLoad.sceneFilename,
          scene,
        );

        if (requestId !== loadRequestIdRef.current) {
          result.meshes.forEach((mesh) => {
            mesh.dispose(true, false);
          });
          return;
        }

        const meshes = result.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh);
        const renderableMeshes = meshes.filter((mesh) => mesh.getTotalVertices() > 0);

        originalMaterialsRef.current.clear();
        renderableMeshes.forEach((mesh) => {
          originalMaterialsRef.current.set(mesh, mesh.material);
          mesh.material = viewerMaterial;
          glowLayer.addIncludedOnlyMesh(mesh);
        });

        currentMeshesRef.current = meshes;
        setHasTexture(false);
        setHasModel(true);
        setLoadedModelName(findMainModelFile(files).modelFile?.relativePath ?? null);
        setMetrics(analyzeModel(renderableMeshes));

        if (renderableMeshes.length > 0) {
          const boundingInfo = Mesh.MinMax(renderableMeshes);
          const center = boundingInfo.min.add(boundingInfo.max).scale(0.5);
          const size = boundingInfo.max.subtract(boundingInfo.min).length();
          const nextRadius = Math.max(size * 1.25, 2.5);
          animateCameraTo(scene, camera, center, nextRadius);
        }

        setIsLoading(false);
        setIsFading(false);
      } catch (error) {
        if (requestId !== loadRequestIdRef.current) {
          return;
        }

        revokeBlobUrls();
        clearSceneMeshes();
        setHasModel(false);
        setHasTexture(false);
        setLoadedModelName(null);

        const message =
          error instanceof Error ? error.message : "Nie udało się załadować modelu 3D.";
        setErrorMessage(message);
        setPanelMessage(message);
        setMetrics(null);
        setIsLoading(false);
        setIsFading(false);
      }
    },
    [clearSceneMeshes, revokeBlobUrls],
  );

  const handleFolderSelection = useCallback(
    async (files: FolderFile[]) => {
      await loadModelFromFolder(files);
    },
    [loadModelFromFolder],
  );

  const handleDirectoryInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files;

      if (!fileList || fileList.length === 0) {
        return;
      }

      void handleFolderSelection(collectFilesFromFileList(fileList));
      event.target.value = "";
    },
    [handleFolderSelection],
  );

  const handlePickFolder = useCallback(async () => {
    const pickerWindow = window as Window & {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    };

    if (!pickerWindow.showDirectoryPicker) {
      folderInputRef.current?.click();
      return;
    }

    try {
      const directoryHandle = await pickerWindow.showDirectoryPicker();
      const files = await readDirectoryHandle(directoryHandle);
      await handleFolderSelection(files);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setPanelMessage(
        error instanceof Error ? error.message : "Nie udało się otworzyć wybranego folderu.",
      );
    }
  }, [handleFolderSelection]);

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragActive(false);

      try {
        const files = await collectFilesFromDataTransfer(event.dataTransfer);
        await handleFolderSelection(files);
      } catch (error) {
        setPanelMessage(
          error instanceof Error ? error.message : "Nie udało się wczytać upuszczonego folderu.",
        );
      }
    },
    [handleFolderSelection],
  );

  const toggleTexture = useCallback(() => {
    const nextHasTexture = !hasTexture;
    setHasTexture(nextHasTexture);
    applyTextureMode(nextHasTexture);
  }, [applyTextureMode, hasTexture]);

  const removeModel = useCallback(() => {
    loadRequestIdRef.current += 1;
    clearSceneMeshes();
    revokeBlobUrls();
    setHasModel(false);
    setHasTexture(false);
    setLoadedModelName(null);
    setMetrics(null);
    setErrorMessage(null);
    setPanelMessage(null);
    setIsLoading(false);
    setIsFading(false);
  }, [clearSceneMeshes, revokeBlobUrls]);

  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const engine = new Engine(canvas, true, {
      adaptToDeviceRatio: true,
      preserveDrawingBuffer: true,
      stencil: true,
    });
    const scene = new Scene(engine);
    engineRef.current = engine;
    sceneRef.current = scene;
    setSceneVersion((version) => version + 1);
    scene.clearColor = new Color4(0.96, 0.97, 0.98, 1);
    scene.createDefaultEnvironment({
      createGround: false,
      createSkybox: true,
      skyboxSize: 1000,
      skyboxColor: new Color3(0.96, 0.97, 0.98),
      enableGroundMirror: false,
    });
    scene.environmentIntensity = 0.85;

    const glowLayer = new GlowLayer("model-glow", scene, {
      blurKernelSize: 32,
    });
    glowLayerRef.current = glowLayer;
    glowLayer.intensity = 0.18;

    const camera = new ArcRotateCamera(
      "model-camera",
      Tools.ToRadians(135),
      Tools.ToRadians(65),
      4,
      Vector3.Zero(),
      scene,
    );
    cameraRef.current = camera;
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 1.5;
    camera.upperRadiusLimit = 12;
    camera.wheelDeltaPercentage = 0.02;
    camera.panningSensibility = 75;

    const light = new HemisphericLight("studio-light", new Vector3(0, 1, 0), scene);
    light.intensity = 0.9;
    light.groundColor = new Color3(0.58, 0.62, 0.68);

    const viewerMaterial = new PBRMaterial("professional-pbr", scene);
    viewerMaterial.albedoColor = new Color3(0.82, 0.84, 0.87);
    viewerMaterial.emissiveColor = new Color3(0.025, 0.03, 0.035);
    viewerMaterial.metallic = 0.18;
    viewerMaterial.roughness = 0.38;
    materialRef.current = viewerMaterial;

    const resize = debounce(() => {
      engine.resize();
    });

    window.addEventListener("resize", resize);

    engine.runRenderLoop(() => {
      scene.render();
    });

    return () => {
      loadRequestIdRef.current += 1;
      window.removeEventListener("resize", resize);
      resize.cancel();
      revokeBlobUrls();
      currentMeshesRef.current = [];
      originalMaterialsRef.current.clear();
      engineRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      glowLayerRef.current = null;
      materialRef.current = null;
      engine.stopRenderLoop();
      engine.dispose();
    };
  }, [revokeBlobUrls]);

  useEffect(() => {
    const scene = sceneRef.current;
    const engine = engineRef.current;

    if (!showDebug || !scene || !engine) {
      setFps("0");
      return;
    }

    let lastFpsUpdate = 0;
    const fpsCallback = () => {
      const now = performance.now();

      if (now - lastFpsUpdate < 250) {
        return;
      }

      lastFpsUpdate = now;
      setFps(engine.getFps().toFixed());
    };

    scene.registerBeforeRender(fpsCallback);

    return () => {
      scene.unregisterBeforeRender(fpsCallback);
    };
  }, [sceneVersion, showDebug]);

  return (
    <div className={className}>
      <div
        style={{
          position: "relative",
          width: "100%",
          minHeight: "420px",
          overflow: "hidden",
          borderRadius: "8px",
          background: "#f4f6f8",
        }}
      >
        <canvas
          ref={canvasRef}
          aria-label="Interaktywny podgląd modelu 3D"
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            minHeight: "420px",
            opacity: isFading ? 0.25 : 1,
            transition: "opacity 220ms ease",
            touchAction: "none",
            outline: "none",
          }}
        />

        <button
          type="button"
          onClick={toggleTexture}
          disabled={isLoading || !hasModel}
          aria-pressed={hasTexture}
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            zIndex: 2,
            border: 0,
            borderRadius: "6px",
            padding: "10px 14px",
            color: "#ffffff",
            background: hasTexture ? "#166534" : "#475569",
            cursor: isLoading || !hasModel ? "not-allowed" : "pointer",
            fontSize: "14px",
            fontWeight: 600,
            opacity: isLoading || !hasModel ? 0.72 : 1,
            transition: "background 180ms ease, opacity 180ms ease, transform 180ms ease",
          }}
        >
          {hasTexture ? "Bez textury" : "Textura"}
        </button>

        {metrics && !errorMessage && (
          <aside className="absolute bottom-4 left-4 z-20 w-[min(280px,calc(100%-32px))] rounded-lg border border-slate-200 bg-white/90 p-4 text-slate-900 shadow-lg shadow-slate-900/10 backdrop-blur">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-normal">Quality Report</h2>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                {hasTexture ? "Textura" : "Bez textury"}
              </span>
            </div>

            <dl className="grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Total vertices</dt>
                <dd className="font-semibold tabular-nums">{numberFormatter.format(metrics.totalVertices)}</dd>
              </div>

              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Watertight</dt>
                <dd className={metrics.isWatertight ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
                  {metrics.isWatertight ? "Likely yes" : "Needs check"}
                </dd>
              </div>

              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Complexity score</dt>
                <dd className="font-semibold tabular-nums">{numberFormatter.format(metrics.complexityScore)} / 100</dd>
              </div>
            </dl>
          </aside>
        )}

        {showDebug && (
          <div className="absolute left-4 top-4 z-20 rounded bg-slate-950/60 px-2 py-1 font-mono text-xs tabular-nums text-white backdrop-blur">
            {fps} FPS
          </div>
        )}

        {!hasModel && !isLoading && !errorMessage && (
          <div
            className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm text-slate-500"
            aria-hidden="true"
          >
            Wybierz folder z modelem poniżej, aby rozpocząć podgląd.
          </div>
        )}

        {isLoading && (
          <div
            role="status"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              padding: "24px",
              color: "#172033",
              background: "rgba(244, 246, 248, 0.72)",
              fontSize: "14px",
              textAlign: "center",
            }}
          >
            Ładowanie modelu 3D...
          </div>
        )}

        {errorMessage && !isLoading && (
          <div
            role="alert"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              padding: "24px",
              color: "#172033",
              background: "rgba(244, 246, 248, 0.72)",
              fontSize: "14px",
              textAlign: "center",
            }}
          >
            {errorMessage}
          </div>
        )}
      </div>

      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Źródło modelu</h2>
            <p className="mt-1 text-sm text-slate-600">
              Wybierz folder z modelem (<code className="text-xs">.glb</code> lub{" "}
              <code className="text-xs">.gltf</code> z teksturami). Pliki są wczytywane lokalnie w
              pamięci przeglądarki — nic nie trafia na serwer.
            </p>
          </div>

          <div
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (event.currentTarget.contains(event.relatedTarget as Node)) {
                return;
              }
              setIsDragActive(false);
            }}
            onDrop={handleDrop}
            className={`rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
              isDragActive
                ? "border-slate-500 bg-slate-50"
                : "border-slate-200 bg-slate-50/60 hover:border-slate-300"
            }`}
          >
            <p className="text-sm font-medium text-slate-700">Przeciągnij i upuść folder z modelem</p>
            <p className="mt-1 text-xs text-slate-500">Obsługiwane formaty: .glb, .gltf + powiązane tekstury</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={folderInputRef}
              type="file"
              multiple
              onChange={handleDirectoryInputChange}
              className="hidden"
              {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
            />

            <button
              type="button"
              onClick={handlePickFolder}
              disabled={isLoading}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Wybierz folder
            </button>

            <button
              type="button"
              onClick={removeModel}
              disabled={!hasModel || isLoading}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Usuń model
            </button>
          </div>

          {loadedModelName && !errorMessage && (
            <p className="text-sm text-slate-600">
              Wczytany model: <span className="font-medium text-slate-900">{loadedModelName}</span>
            </p>
          )}

          {panelMessage && (
            <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {panelMessage}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
