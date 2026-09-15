import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr, AdaptiveEvents, MapControls, Preload } from '@react-three/drei';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import {
  REGION_LOD_DISTANCE,
  useMapStore,
  type Bounds,
  type PlotTile,
} from '../../store/map.store';
import { useWorldStore } from '../../store/world.store';
import { PlotBorders, PlotLayer } from './PlotLayer';
import { RegionGrid, RegionLayer } from './RegionLayer';

/**
 * The world map.
 *
 * Scene units are *plot* units: one unit on the ground is one plot, so a
 * 100x100 plot world is a 100x100 board. That keeps every coordinate
 * conversion in one place (here) rather than scattered through the renderer.
 */

interface WorldMapSceneProps {
  onSelect: (tile: PlotTile) => void;
  selectedId: string | null;
  /** Region containing the player's home, highlighted at far zoom. */
  homeRegionId?: string | null;
  showStats?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Viewport tracking                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Watches the camera and streams the plots it can see.
 *
 * Two things keep this from hammering the API: the request is debounced past
 * the end of a drag, and the store skips the call entirely when the new
 * rectangle is already inside the last one it fetched. Above the LOD
 * threshold it stops streaming plots altogether - the region layer is showing
 * instead, and there is nothing to draw them into.
 */
function ViewportStreamer({ plotsPerSide }: { plotsPerSide: number }) {
  const { camera, controls } = useThree();
  const streamViewport = useMapStore((s) => s.streamViewport);
  const timer = useRef<number | null>(null);
  const lastKey = useRef('');

  const compute = useCallback((): { bounds: Bounds; distance: number } => {
    const target =
      (controls as MapControlsImpl | null)?.target ?? new THREE.Vector3(0, 0, 0);
    const distance = camera.position.distanceTo(target);

    // Half-extent of what the camera covers on the ground plane. Derived from
    // the vertical FOV and the orbit distance, widened a little so a fast pan
    // does not outrun the fetch.
    const perspective = camera as THREE.PerspectiveCamera;
    const fov = ((perspective.fov ?? 45) * Math.PI) / 180;
    const halfHeight = Math.tan(fov / 2) * distance * 1.25;
    const halfWidth = halfHeight * (perspective.aspect ?? 1.6);

    return {
      distance,
      bounds: {
        minX: Math.max(0, Math.floor(target.x - halfWidth)),
        minY: Math.max(0, Math.floor(target.z - halfHeight)),
        maxX: Math.min(plotsPerSide - 1, Math.ceil(target.x + halfWidth)),
        maxY: Math.min(plotsPerSide - 1, Math.ceil(target.z + halfHeight)),
      },
    };
  }, [camera, controls, plotsPerSide]);

  useFrame(() => {
    const { bounds, distance } = compute();
    if (distance > REGION_LOD_DISTANCE) return;

    // Quantise so sub-plot camera jitter does not look like a new viewport.
    const key = [
      Math.floor(bounds.minX / 4),
      Math.floor(bounds.minY / 4),
      Math.floor(bounds.maxX / 4),
      Math.floor(bounds.maxY / 4),
    ].join(':');
    if (key === lastKey.current) return;
    lastKey.current = key;

    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void streamViewport(bounds).then((covered) => {
        // The store drops a request when another is already in flight. Clear
        // the key so the next frame re-arms it: otherwise a camera that stops
        // at exactly that moment leaves those tiles permanently unloaded.
        if (!covered && lastKey.current === key) lastKey.current = '';
      });
    }, 180);
  });

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return null;
}

/* -------------------------------------------------------------------------- */
/* Camera control                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Flies the camera to a requested target.
 *
 * Reads `cameraTarget` from the store rather than taking a prop so any part of
 * the UI - the My Empire button, a search result, a plot list - can move the
 * camera without threading a ref through the tree.
 */
function CameraDirector({ onDistanceChange }: { onDistanceChange: (d: number) => void }) {
  const { camera, controls } = useThree();
  const target = useMapStore((s) => s.cameraTarget);
  const appliedNonce = useRef(-1);

  const desired = useRef<{ x: number; y: number; distance: number } | null>(null);
  const animating = useRef(false);

  useEffect(() => {
    if (!target || target.nonce === appliedNonce.current) return;
    appliedNonce.current = target.nonce;
    desired.current = { x: target.x, y: target.y, distance: target.distance };
    animating.current = target.animate;

    if (!target.animate) {
      const impl = controls as MapControlsImpl | null;
      if (impl) {
        impl.target.set(target.x, 0, target.y);
        camera.position.set(target.x, target.distance * 0.72, target.y + target.distance * 0.7);
        impl.update();
      }
      desired.current = null;
    }
  }, [target, camera, controls]);

  useFrame((_, delta) => {
    const impl = controls as MapControlsImpl | null;
    if (impl) onDistanceChange(camera.position.distanceTo(impl.target));

    if (!animating.current || !desired.current || !impl) return;

    const goal = desired.current;
    // Frame-rate independent easing: the same visual speed at 30 or 144 fps.
    const t = 1 - Math.pow(0.0025, delta);

    impl.target.lerp(new THREE.Vector3(goal.x, 0, goal.y), t);
    camera.position.lerp(
      new THREE.Vector3(goal.x, goal.distance * 0.72, goal.y + goal.distance * 0.7),
      t,
    );
    impl.update();

    if (impl.target.distanceTo(new THREE.Vector3(goal.x, 0, goal.y)) < 0.35) {
      animating.current = false;
      desired.current = null;
    }
  });

  return null;
}

/* -------------------------------------------------------------------------- */
/* Lighting and water                                                          */
/* -------------------------------------------------------------------------- */

function MapLighting({ extent }: { extent: number }) {
  return (
    <>
      <ambientLight intensity={0.72} color="#c8d4ea" />
      <hemisphereLight args={['#a9c6ff', '#33291d', 0.55]} />
      <directionalLight
        position={[extent * 0.5, extent * 0.9, extent * 0.35]}
        intensity={1.35}
        color="#fff2d6"
        castShadow={false}
      />
    </>
  );
}

/** The sea the landmass sits in, so the world has an edge rather than a void. */
function Ocean({ extent }: { extent: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[extent / 2, -0.25, extent / 2]}>
      <planeGeometry args={[extent * 3, extent * 3]} />
      <meshStandardMaterial color="#16324d" roughness={0.6} metalness={0.15} />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/* Scene                                                                       */
/* -------------------------------------------------------------------------- */

export function WorldMapScene({
  onSelect,
  selectedId,
  homeRegionId,
  showStats = false,
}: WorldMapSceneProps) {
  const world = useWorldStore((s) => s.world);
  const regions = useWorldStore((s) => s.regions);
  const tiles = useMapStore((s) => s.tiles);
  const [distance, setDistance] = useState(80);
  const [hovered, setHovered] = useState<PlotTile | null>(null);

  const plotsPerSide = world?.counts.plotsPerSide ?? 100;
  const extent = plotsPerSide;

  const visibleTiles = useMemo(() => [...tiles.values()], [tiles]);
  const showPlots = distance <= REGION_LOD_DISTANCE;

  // The cursor is the only affordance telling the player a tile is clickable.
  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : 'auto';
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, [hovered]);

  return (
    <Canvas
      shadows={false}
      dpr={[1, 1.75]}
      camera={{
        position: [extent / 2, 90, extent / 2 + 80],
        fov: 45,
        near: 1,
        far: extent * 6,
      }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        scene.background = new THREE.Color('#0c0f18');
        scene.fog = new THREE.Fog('#0c0f18', extent * 1.4, extent * 4);
      }}
    >
      <Suspense fallback={null}>
        <MapLighting extent={extent} />
        <Ocean extent={extent} />

        {/* The two layers are mutually exclusive. Drawing regions underneath
            the plots looks reasonable in theory and is wrong in practice: a
            region slab is 10 units across and taller than an unclaimed plot,
            so it swallows every FREE tile and only the raised owned ones show
            through. Far out, regions ARE the map; close in, plots are. */}
        {showPlots ? (
          <>
            <PlotLayer
              tiles={visibleTiles}
              selectedId={selectedId}
              onSelect={onSelect}
              onHover={setHovered}
            />
            <PlotBorders tiles={visibleTiles} />
          </>
        ) : (
          <>
            <RegionLayer
              regions={regions}
              plotSize={world?.plotSize ?? 10}
              highlightRegionId={homeRegionId ?? null}
            />
            <RegionGrid
              regionsPerSide={world?.counts.regionsPerSide ?? 10}
              plotsPerSide={plotsPerSide}
            />
          </>
        )}

        <Preload all />
      </Suspense>

      <MapControls
        makeDefault
        target={[extent / 2, 0, extent / 2]}
        enableDamping
        dampingFactor={0.09}
        minDistance={12}
        maxDistance={520}
        maxPolarAngle={Math.PI / 2.15}
        minPolarAngle={0.1}
        screenSpacePanning={false}
        // Touch: one finger pans, two pinch-zoom and rotate. Matches what a
        // player expects from a map on a phone.
        touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }}
      />

      <ViewportStreamer plotsPerSide={plotsPerSide} />
      <CameraDirector onDistanceChange={setDistance} />

      <AdaptiveDpr pixelated />
      <AdaptiveEvents />
      {showStats && <StatsOverlay />}
    </Canvas>
  );
}

/** Lazily-imported drei Stats would add a chunk; this is enough for a dev HUD. */
function StatsOverlay() {
  const [fps, setFps] = useState(0);
  const frames = useRef(0);
  const since = useRef(performance.now());

  useFrame(() => {
    frames.current++;
    const now = performance.now();
    if (now - since.current >= 1000) {
      setFps(frames.current);
      frames.current = 0;
      since.current = now;
    }
  });

  useEffect(() => {
    const el = document.getElementById('map-fps');
    if (el) el.textContent = `${fps} fps`;
  }, [fps]);

  return null;
}
