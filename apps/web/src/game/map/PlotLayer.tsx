import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlotTile } from '../../store/map.store';
import { plotAppearance } from './plotAppearance';

/**
 * Every visible plot, drawn as a single instanced mesh.
 *
 * A viewport can hold 2 500 plots. As individual meshes that is 2 500 draw
 * calls per frame, which stutters on any laptop. Instanced, it is one - the
 * per-plot colour and height ride along in instance attributes.
 *
 * The cost is that picking has to go through `instanceId` rather than a mesh
 * reference, which is what the index map below is for.
 */

interface PlotLayerProps {
  tiles: PlotTile[];
  selectedId: string | null;
  onSelect: (tile: PlotTile) => void;
  onHover: (tile: PlotTile | null) => void;
}

const dummy = new THREE.Object3D();
const colour = new THREE.Color();

export function PlotLayer({ tiles, selectedId, onSelect, onHover }: PlotLayerProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Stable array so instanceId -> tile stays valid between renders.
  const ordered = useMemo(() => tiles, [tiles]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || ordered.length === 0) return;

    for (let i = 0; i < ordered.length; i++) {
      // Bounded by the loop condition, so the index is always in range.
      const tile = ordered[i] as (typeof ordered)[number];
      const look = plotAppearance(tile.biome, tile.status, tile.isMine);
      const selected = tile.id === selectedId;

      // A selected plot is lifted and slightly inset, so the highlight is a
      // shape change rather than only a colour change.
      const height = look.height + (selected ? 0.5 : 0);
      const inset = selected ? 0.86 : 0.94;

      dummy.position.set(tile.x + 0.5, height / 2, tile.y + 0.5);
      dummy.scale.set(inset, Math.max(0.04, height), inset);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      colour.set(selected ? '#f9e3a5' : look.color);
      mesh.setColorAt(i, colour);
    }

    mesh.count = ordered.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [ordered, selectedId]);

  if (ordered.length === 0) return null;

  const pick = (event: ThreeEvent<MouseEvent>): PlotTile | null => {
    const index = event.instanceId;
    if (index === undefined) return null;
    return ordered[index] ?? null;
  };

  return (
    <instancedMesh
      ref={meshRef}
      // `key` forces a fresh buffer when the tile count grows past the
      // allocation; InstancedMesh cannot resize in place.
      key={ordered.length}
      args={[undefined, undefined, ordered.length]}
      castShadow={false}
      receiveShadow
      frustumCulled
      onClick={(event) => {
        event.stopPropagation();
        const tile = pick(event);
        if (tile) onSelect(tile);
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        onHover(pick(event));
      }}
      onPointerOut={() => onHover(null)}
    >
      <boxGeometry args={[1, 1, 1]} />
      {/* No `vertexColors`: instance colours come from InstancedMesh's
          instanceColor buffer, and enabling vertexColors would make the shader
          look for a per-vertex attribute the box geometry does not have -
          which renders every instance black. */}
      <meshStandardMaterial roughness={0.85} metalness={0.02} flatShading />
    </instancedMesh>
  );
}

/**
 * Ownership outlines.
 *
 * Drawn as a separate line layer rather than baked into the instanced mesh:
 * lines need their own material, and only a handful of plots are ever owned
 * in view, so the extra draw call is cheap and keeps the borders crisp at any
 * zoom.
 */
export function PlotBorders({ tiles }: { tiles: PlotTile[] }) {
  const owned = useMemo(
    () => tiles.filter((t) => t.status !== 'FREE' && t.status !== 'UNAVAILABLE'),
    [tiles],
  );

  const geometry = useMemo(() => {
    if (owned.length === 0) return null;

    const positions: number[] = [];
    for (const tile of owned) {
      const look = plotAppearance(tile.biome, tile.status, tile.isMine);
      const y = look.height + 0.03;
      const x0 = tile.x + 0.06;
      const x1 = tile.x + 0.94;
      const z0 = tile.y + 0.06;
      const z1 = tile.y + 0.94;

      // Four edges as line segments.
      positions.push(
        x0, y, z0, x1, y, z0,
        x1, y, z0, x1, y, z1,
        x1, y, z1, x0, y, z1,
        x0, y, z1, x0, y, z0,
      );
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [owned]);

  const colours = useMemo(() => {
    if (owned.length === 0) return null;
    const values: number[] = [];
    const c = new THREE.Color();
    for (const tile of owned) {
      c.set(plotAppearance(tile.biome, tile.status, tile.isMine).edge);
      // Eight vertices per plot (four segments).
      for (let i = 0; i < 8; i++) values.push(c.r, c.g, c.b);
    }
    return new THREE.Float32BufferAttribute(values, 3);
  }, [owned]);

  useLayoutEffect(() => {
    if (geometry && colours) geometry.setAttribute('color', colours);
  }, [geometry, colours]);

  if (!geometry) return null;

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={0.95} />
    </lineSegments>
  );
}
