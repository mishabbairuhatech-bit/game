import { Suspense, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  AdaptiveDpr,
  AdaptiveEvents,
  ContactShadows,
  MapControls,
  Preload,
  Stats,
} from '@react-three/drei';
import * as THREE from 'three';
import { BIOME_PROFILE, BUILDING_BY_KEY, WORLD } from '@empire/game-data';
import { Rng, fbm2D } from '@empire/game-engine';
import { PlaceholderMesh } from './PlaceholderMesh';

// The empire view renders one plot at its configured tile size.
const PLOT_TILES = WORLD.plotSize; // 10 by default

/**
 * Vertical range of the plot's terrain, in world units.
 *
 * Deliberately small: this is a build surface, and a footprint has to sit flat
 * on it. The relief exists to stop the plot reading as a flat card, not to be
 * traversed. BuildGrid keys its height off the same constant.
 */
const TERRAIN_AMPLITUDE = 0.32;

export interface SceneBuilding {
  id: string;
  buildingKey: string;
  level: number;
  tileX: number;
  tileY: number;
  rotation: number;
}

/* -------------------------------------------------------------------------- */
/* Terrain                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The plot's ground plane.
 *
 * Height comes from the same deterministic noise the server uses for world
 * generation, keyed on the plot's seed - so the terrain a player sees is
 * reproducible and identical on every device, which matters once battles are
 * replayed from a seed.
 */
function Ground({ seed, biome }: { seed: string; biome: keyof typeof BIOME_PROFILE }) {
  const profile = BIOME_PROFILE[biome];

  const geometry = useMemo(() => {
    const segments = PLOT_TILES;
    const geo = new THREE.PlaneGeometry(PLOT_TILES, PLOT_TILES, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const numericSeed = new Rng(seed).int(0, 2 ** 30);
    const position = geo.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      // Gentle relief only: a build grid has to stay readable and placeable.
      const h = fbm2D(numericSeed, (x + 64) * 0.08, (z + 64) * 0.08, 3) * TERRAIN_AMPLITUDE;
      position.setY(i, h);
    }

    position.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }, [seed]);

  return (
    <group>
      <mesh geometry={geometry} receiveShadow position={[PLOT_TILES / 2, 0, PLOT_TILES / 2]}>
        <meshStandardMaterial color={profile.ground} roughness={0.95} flatShading />
      </mesh>

      {/* Plot boundary - makes "inside my territory" legible before the
          building editor exists. */}
      <lineSegments position={[PLOT_TILES / 2, TERRAIN_AMPLITUDE + 0.05, PLOT_TILES / 2]}>
        <edgesGeometry args={[new THREE.BoxGeometry(PLOT_TILES, 0.02, PLOT_TILES)]} />
        <lineBasicMaterial color="#e6b13f" transparent opacity={0.55} />
      </lineSegments>
    </group>
  );
}

/**
 * Faint build grid so footprints line up visually with tile coordinates.
 *
 * Sits just above the terrain's peak (see TERRAIN_AMPLITUDE) - at y=0 the
 * relief swallows most of the lines and the grid shows up as disconnected
 * fragments.
 */
function BuildGrid() {
  return (
    <gridHelper
      args={[PLOT_TILES, PLOT_TILES, '#6b7690', '#3a4356']}
      position={[PLOT_TILES / 2, TERRAIN_AMPLITUDE + 0.04, PLOT_TILES / 2]}
    />
  );
}

/**
 * The world beyond the plot.
 *
 * Without this the plot floats against the clear colour, which reads as an
 * unfinished render rather than a frontier. A large dark plane plus fog gives
 * the territory an edge and keeps the scene inside the UI's palette instead of
 * fighting it with a bright procedural sky.
 */
function Surrounds() {
  const half = PLOT_TILES / 2;
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[half, -0.35, half]}
        receiveShadow={false}
      >
        <planeGeometry args={[420, 420]} />
        <meshStandardMaterial color="#1b2436" roughness={1} />
      </mesh>

      {/* A soft ring of unclaimed land so the plot edge reads as a border
          rather than a cliff. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[half, -0.12, half]}>
        <ringGeometry args={[half * 1.05, half * 2.6, 48]} />
        <meshStandardMaterial color="#2c3a2a" roughness={1} />
      </mesh>
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/* Scatter props                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Decoration (trees, boulders) drawn as a single instanced mesh.
 *
 * One draw call for hundreds of props instead of hundreds of draw calls - the
 * difference between a smooth frame and a stutter on a mid-range laptop.
 */
function ScatterProps({
  seed,
  biome,
  occupied,
}: {
  seed: string;
  biome: keyof typeof BIOME_PROFILE;
  occupied: Set<string>;
}) {
  const profile = BIOME_PROFILE[biome];
  const isForest = profile.props.includes('forest_tree');

  // Cone/dodecahedron geometry is origin-centred, so an instance placed at
  // y=0 sits half underground. Lift each one by half its own height.
  const propHeight = isForest ? 2.2 : 1.1;

  const transforms = useMemo(() => {
    const rng = new Rng(`${seed}:props`);
    const out: { position: [number, number, number]; scale: number; rotation: number }[] = [];
    const attempts = isForest ? 90 : 40;

    for (let i = 0; i < attempts; i++) {
      const tx = rng.int(0, PLOT_TILES - 1);
      const ty = rng.int(0, PLOT_TILES - 1);
      // Never scatter onto a tile a building occupies.
      if (occupied.has(`${tx},${ty}`)) continue;
      // Keep the middle clear so the base stays the focal point.
      const dx = tx - PLOT_TILES / 2;
      const dy = ty - PLOT_TILES / 2;
      if (Math.hypot(dx, dy) < 4.5) continue;

      const scale = rng.float(0.7, 1.35);
      out.push({
        position: [
          tx + rng.float(0.2, 0.8),
          (propHeight * scale) / 2,
          ty + rng.float(0.2, 0.8),
        ],
        scale,
        rotation: rng.float(0, Math.PI * 2),
      });
    }
    return out;
  }, [seed, isForest, occupied, propHeight]);

  const meshRef = useRef<THREE.InstancedMesh>(null);

  // useLayoutEffect, not useMemo: useMemo runs during render, before React has
  // attached the ref, so the matrices would be written to nothing and every
  // instance would collapse onto the origin.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    transforms.forEach((t, index) => {
      matrix.makeRotationY(t.rotation);
      matrix.scale(scale.set(t.scale, t.scale, t.scale));
      matrix.setPosition(t.position[0], t.position[1], t.position[2]);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.count = transforms.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [transforms]);

  if (transforms.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, transforms.length]}
      castShadow
      receiveShadow
      // Frustum culling is on by default; the bounding sphere above keeps it
      // correct for an instanced mesh.
      frustumCulled
    >
      {isForest ? (
        <coneGeometry args={[0.5, 2.2, 7]} />
      ) : (
        <dodecahedronGeometry args={[0.55, 0]} />
      )}
      <meshStandardMaterial
        color={isForest ? '#2f6b3a' : '#8c8378'}
        roughness={0.9}
        flatShading
      />
    </instancedMesh>
  );
}

/* -------------------------------------------------------------------------- */
/* Buildings                                                                   */
/* -------------------------------------------------------------------------- */

function BuildingInstance({ building }: { building: SceneBuilding }) {
  const definition = BUILDING_BY_KEY.get(building.buildingKey);
  if (!definition) return null;

  const rotated = building.rotation === 90 || building.rotation === 270;
  const width = rotated ? definition.footprint.height : definition.footprint.width;
  const depth = rotated ? definition.footprint.width : definition.footprint.height;

  // Tile coordinates address a footprint's origin corner; the mesh is centred,
  // so offset by half the footprint.
  const x = building.tileX + width / 2;
  const z = building.tileY + depth / 2;

  return (
    <group position={[x, 0, z]} rotation={[0, (building.rotation * Math.PI) / 180, 0]}>
      <PlaceholderMesh asset={definition.asset} />
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/* Lighting                                                                    */
/* -------------------------------------------------------------------------- */

function Lighting() {
  const light = useRef<THREE.DirectionalLight>(null);

  // A very slow sun drift keeps the scene from looking like a static render
  // without costing anything measurable.
  useFrame(({ clock }) => {
    if (!light.current) return;
    const t = clock.elapsedTime * 0.02;
    light.current.position.set(18 + Math.sin(t) * 6, 26, 14 + Math.cos(t) * 6);
  });

  return (
    <>
      <ambientLight intensity={0.5} color="#b8c4dc" />
      <hemisphereLight args={['#9fc0ff', '#3a3226', 0.65]} />
      <directionalLight
        ref={light}
        position={[18, 26, 14]}
        intensity={1.85}
        color="#ffeecb"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
        shadow-camera-near={1}
        shadow-camera-far={80}
        shadow-bias={-0.0004}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Scene                                                                       */
/* -------------------------------------------------------------------------- */

export interface EmpireSceneProps {
  /** Stable seed - use the plot code so terrain never shifts between sessions. */
  seed: string;
  biome: keyof typeof BIOME_PROFILE;
  buildings: SceneBuilding[];
  showStats?: boolean;
}

export function EmpireScene({ seed, biome, buildings, showStats = false }: EmpireSceneProps) {
  const occupied = useMemo(() => {
    const set = new Set<string>();
    for (const b of buildings) {
      const def = BUILDING_BY_KEY.get(b.buildingKey);
      if (!def) continue;
      const rotated = b.rotation === 90 || b.rotation === 270;
      const w = rotated ? def.footprint.height : def.footprint.width;
      const h = rotated ? def.footprint.width : def.footprint.height;
      for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) set.add(`${b.tileX + dx},${b.tileY + dy}`);
      }
    }
    return set;
  }, [buildings]);

  return (
    <Canvas
      shadows
      // Cap DPR: a 3x retina display would otherwise render 9x the pixels for
      // no visible gain on flat-shaded geometry.
      dpr={[1, 1.75]}
      camera={{ position: [26, 22, 26], fov: 42, near: 0.5, far: 400 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.0;
        // Matches --color-ink-950 so the canvas and the surrounding UI read as
        // one surface rather than two.
        scene.background = new THREE.Color('#0c0f18');
        scene.fog = new THREE.Fog('#0c0f18', 45, 130);
      }}
    >
      <Suspense fallback={null}>
        <Lighting />
        <Surrounds />

        <Ground seed={seed} biome={biome} />
        <BuildGrid />
        <ScatterProps seed={seed} biome={biome} occupied={occupied} />

        {buildings.map((building) => (
          <BuildingInstance key={building.id} building={building} />
        ))}

        {/* Grounds the buildings against the terrain far more cheaply than
            raising the shadow-map resolution would. */}
        <ContactShadows
          position={[PLOT_TILES / 2, 0.05, PLOT_TILES / 2]}
          scale={PLOT_TILES * 1.4}
          resolution={1024}
          blur={2.4}
          opacity={0.45}
          far={12}
          frames={1}
        />

        <Preload all />
      </Suspense>

      <MapControls
        makeDefault
        target={[PLOT_TILES / 2, 0, PLOT_TILES / 2]}
        enableDamping
        dampingFactor={0.08}
        minDistance={8}
        maxDistance={70}
        // Stop the camera dropping below the ground plane.
        maxPolarAngle={Math.PI / 2.25}
        minPolarAngle={0.18}
        screenSpacePanning={false}
      />

      {/* Drop resolution and event frequency while the camera is moving,
          then restore it - keeps panning smooth on weaker GPUs. */}
      <AdaptiveDpr pixelated />
      <AdaptiveEvents />
      {showStats && <Stats />}
    </Canvas>
  );
}
