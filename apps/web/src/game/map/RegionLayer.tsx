import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TERRAIN_RULES } from '@empire/game-data';
import type { RegionSummary } from '../../store/world.store';

/**
 * The far-zoom layer.
 *
 * Above REGION_LOD_DISTANCE a single plot is smaller than a pixel, so drawing
 * 2 500 of them is pure waste. This layer swaps in one quad per region - a
 * hundred instances for the whole world - which keeps the map readable while
 * the camera is pulled right out, and means the client stops streaming plots
 * entirely at that height.
 */

interface RegionLayerProps {
  regions: RegionSummary[];
  /** Tiles per plot, so region extents can be expressed in plot units. */
  plotSize: number;
  /** Highlighted region, e.g. the one containing the player's territory. */
  highlightRegionId?: string | null;
}

const dummy = new THREE.Object3D();
const colour = new THREE.Color();

export function RegionLayer({ regions, plotSize, highlightRegionId }: RegionLayerProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || regions.length === 0) return;

    for (let i = 0; i < regions.length; i++) {
      // Bounded by the loop condition, so the index is always in range.
      const region = regions[i] as (typeof regions)[number];
      // The scene works in plot units; regions are stored in tiles.
      const sizeInPlots = region.width / plotSize;
      const originX = region.tileX / plotSize;
      const originY = region.tileY / plotSize;
      const highlighted = region.id === highlightRegionId;

      dummy.position.set(
        originX + sizeInPlots / 2,
        highlighted ? 0.4 : 0.1,
        originY + sizeInPlots / 2,
      );
      dummy.scale.set(sizeInPlots * 0.985, 0.2, sizeInPlots * 0.985);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const rule = TERRAIN_RULES[region.biome];
      colour.set(highlighted ? '#e6b13f' : rule.color);
      mesh.setColorAt(i, colour);
    }

    mesh.count = regions.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [regions, plotSize, highlightRegionId]);

  if (regions.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      key={regions.length}
      args={[undefined, undefined, regions.length]}
      receiveShadow
      frustumCulled
    >
      <boxGeometry args={[1, 1, 1]} />
      {/* See PlotLayer: instance colours must not be combined with vertexColors. */}
      <meshStandardMaterial roughness={0.95} flatShading />
    </instancedMesh>
  );
}

/** Grid lines between regions, so the partitioning is visible at far zoom. */
export function RegionGrid({
  regionsPerSide,
  plotsPerSide,
}: {
  regionsPerSide: number;
  plotsPerSide: number;
}) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const step = plotsPerSide / regionsPerSide;
    const y = 0.24;

    for (let i = 0; i <= regionsPerSide; i++) {
      const at = i * step;
      positions.push(at, y, 0, at, y, plotsPerSide);
      positions.push(0, y, at, plotsPerSide, y, at);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [regionsPerSide, plotsPerSide]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#3a4356" transparent opacity={0.5} />
    </lineSegments>
  );
}
