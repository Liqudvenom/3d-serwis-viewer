"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArcRotateCamera,
  Color3,
  Color4,
  Engine,
  GlowLayer,
  HemisphericLight,
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
  damagedModelUrl: string;
  fixedModelUrl: string;
  className?: string;
  showDebug?: boolean;
};

type ModelMetrics = {
  totalVertices: number;
  isWatertight: boolean;
  complexityScore: number;
};

function splitModelUrl(modelUrl: string) {
  const lastSlashIndex = modelUrl.lastIndexOf("/");

  if (lastSlashIndex === -1) {
    return {
      rootUrl: "",
      sceneFilename: modelUrl,
    };
  }

  return {
    rootUrl: modelUrl.slice(0, lastSlashIndex + 1),
    sceneFilename: modelUrl.slice(lastSlashIndex + 1),
  };
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

export default function ModelViewer({ damagedModelUrl, fixedModelUrl, className, showDebug = false }: ModelViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const cameraRef = useRef<ArcRotateCamera | null>(null);
  const glowLayerRef = useRef<GlowLayer | null>(null);
  const materialRef = useRef<PBRMaterial | null>(null);
  const currentMeshesRef = useRef<Mesh[]>([]);
  const loadRequestIdRef = useRef(0);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isFading, setIsFading] = useState(false);
  const [isFixed, setIsFixed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fps, setFps] = useState("0");
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const numberFormatter = useMemo(() => new Intl.NumberFormat("pl-PL"), []);

  const loadModel = useCallback(async (modelUrl: string, shouldAnimateCamera = true) => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const glowLayer = glowLayerRef.current;
    const viewerMaterial = materialRef.current;

    if (!scene || !camera || !glowLayer || !viewerMaterial) {
      return;
    }

    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setIsLoading(true);
    setErrorMessage(null);
    setIsFading(true);
    setMetrics(null);

    await wait(180);

    if (requestId !== loadRequestIdRef.current) {
      return;
    }

    try {
      await waitForIdle();

      if (requestId !== loadRequestIdRef.current) {
        return;
      }

      currentMeshesRef.current.forEach((mesh) => {
        glowLayer.removeIncludedOnlyMesh(mesh);
        mesh.dispose(true, false);
      });
      currentMeshesRef.current = [];

      const { rootUrl, sceneFilename } = splitModelUrl(modelUrl);
      const result = await SceneLoader.ImportMeshAsync("", rootUrl, sceneFilename, scene);

      if (requestId !== loadRequestIdRef.current) {
        result.meshes.forEach((mesh) => {
          mesh.dispose(true, false);
        });
        return;
      }

      const meshes = result.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh);
      const renderableMeshes = meshes.filter((mesh) => mesh.getTotalVertices() > 0);

      renderableMeshes.forEach((mesh) => {
        mesh.material = viewerMaterial;
        glowLayer.addIncludedOnlyMesh(mesh);
      });

      currentMeshesRef.current = meshes;
      setMetrics(analyzeModel(renderableMeshes));

      if (renderableMeshes.length > 0) {
        const boundingInfo = Mesh.MinMax(renderableMeshes);
        const center = boundingInfo.min.add(boundingInfo.max).scale(0.5);
        const size = boundingInfo.max.subtract(boundingInfo.min).length();
        const nextRadius = Math.max(size * 1.25, 2.5);

        if (shouldAnimateCamera) {
          animateCameraTo(scene, camera, center, nextRadius);
        } else {
          camera.setTarget(center);
          camera.radius = nextRadius;
        }
      }

      setIsLoading(false);
      setIsFading(false);
    } catch (error) {
      if (requestId !== loadRequestIdRef.current) {
        return;
      }

      setErrorMessage(error instanceof Error ? error.message : "Nie udalo sie zaladowac modelu 3D.");
      setMetrics(null);
      setIsLoading(false);
      setIsFading(false);
    }
  }, []);

  const switchModel = useCallback(() => {
    const nextIsFixed = !isFixed;
    setIsFixed(nextIsFixed);
    void loadModel(nextIsFixed ? fixedModelUrl : damagedModelUrl);
  }, [damagedModelUrl, fixedModelUrl, isFixed, loadModel]);

  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setMetrics(null);
    setIsFixed(false);

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

    void loadModel(damagedModelUrl, false);

    engine.runRenderLoop(() => {
      scene.render();
    });

    return () => {
      loadRequestIdRef.current += 1;
      window.removeEventListener("resize", resize);
      resize.cancel();
      currentMeshesRef.current = [];
      engineRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      glowLayerRef.current = null;
      materialRef.current = null;
      engine.stopRenderLoop();
      engine.dispose();
    };
  }, [damagedModelUrl, loadModel]);

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
    <div
      className={className}
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
        aria-label="Interaktywny podglad modelu 3D"
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
        onClick={switchModel}
        disabled={isLoading}
        aria-pressed={isFixed}
        style={{
          position: "absolute",
          top: "16px",
          right: "16px",
          zIndex: 2,
          border: 0,
          borderRadius: "6px",
          padding: "10px 14px",
          color: "#ffffff",
          background: isFixed ? "#166534" : "#991b1b",
          cursor: isLoading ? "not-allowed" : "pointer",
          fontSize: "14px",
          fontWeight: 600,
          opacity: isLoading ? 0.72 : 1,
          transition: "background 180ms ease, opacity 180ms ease, transform 180ms ease",
        }}
      >
        {isFixed ? "Pokaz uszkodzony" : "Pokaz naprawiony"}
      </button>

      {metrics && !errorMessage && (
        <aside className="absolute bottom-4 left-4 z-20 w-[min(280px,calc(100%-32px))] rounded-lg border border-slate-200 bg-white/90 p-4 text-slate-900 shadow-lg shadow-slate-900/10 backdrop-blur">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-normal">Quality Report</h2>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
              {isFixed ? "Fixed" : "Damaged"}
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

      {(isLoading || errorMessage) && (
        <div
          role={errorMessage ? "alert" : "status"}
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
          {errorMessage ?? "Ladowanie modelu 3D..."}
        </div>
      )}
    </div>
  );
}
