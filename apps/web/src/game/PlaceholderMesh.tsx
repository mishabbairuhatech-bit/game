import { useMemo } from 'react';
import * as THREE from 'three';
import type { AssetRef } from '@empire/game-data';

/**
 * Renders the procedural stand-in described by an AssetRef.
 *
 * The asset registry is the seam that keeps art swappable: gameplay code asks
 * for "the mesh for `archer_tower` level 3" and gets whatever the registry
 * points at. Today that is one of these primitives; once a GLB lands in
 * /assets/buildings the registry's `model` field is filled in and this
 * component is bypassed - with no change to any gameplay code.
 */
export function PlaceholderMesh({
  asset,
  tint,
}: {
  asset: AssetRef;
  /** Overrides the registry colour, e.g. green/red placement preview. */
  tint?: string;
}) {
  const { shape, color, accent, scale } = asset.placeholder;
  const [sx, sy, sz] = scale;

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(tint ?? color),
        roughness: 0.72,
        metalness: 0.06,
        flatShading: true,
      }),
    [tint, color],
  );

  const accentMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(tint ?? accent ?? color),
        roughness: 0.6,
        metalness: 0.1,
        flatShading: true,
      }),
    [tint, accent, color],
  );

  switch (shape) {
    case 'cylinder':
      return (
        <mesh castShadow receiveShadow position={[0, sy / 2, 0]} material={material}>
          <cylinderGeometry args={[sx / 2, sx / 2, sy, 12]} />
        </mesh>
      );

    case 'cone':
      return (
        <mesh castShadow receiveShadow position={[0, sy / 2, 0]} material={material}>
          <coneGeometry args={[sx / 2, sy, 10]} />
        </mesh>
      );

    case 'sphere':
      return (
        <mesh castShadow receiveShadow position={[0, sy / 2, 0]} material={material}>
          <sphereGeometry args={[sx / 2, 14, 10]} />
        </mesh>
      );

    case 'pyramid':
      return (
        <group>
          <mesh castShadow receiveShadow position={[0, sy * 0.15, 0]} material={accentMaterial}>
            <boxGeometry args={[sx, sy * 0.3, sz]} />
          </mesh>
          <mesh castShadow receiveShadow position={[0, sy * 0.65, 0]} material={material}>
            <coneGeometry args={[sx * 0.6, sy * 0.7, 4]} />
          </mesh>
        </group>
      );

    // A base block plus a narrower upper storey reads as a tower at a glance,
    // which is what a placeholder has to do.
    case 'tower':
      return (
        <group>
          <mesh castShadow receiveShadow position={[0, sy * 0.35, 0]} material={material}>
            <boxGeometry args={[sx, sy * 0.7, sz]} />
          </mesh>
          <mesh
            castShadow
            receiveShadow
            position={[0, sy * 0.82, 0]}
            material={accentMaterial}
          >
            <boxGeometry args={[sx * 0.72, sy * 0.24, sz * 0.72]} />
          </mesh>
          <mesh castShadow position={[0, sy * 1.02, 0]} material={material}>
            <coneGeometry args={[sx * 0.5, sy * 0.24, 4]} />
          </mesh>
        </group>
      );

    case 'wall':
      return (
        <group>
          <mesh castShadow receiveShadow position={[0, sy / 2, 0]} material={material}>
            <boxGeometry args={[sx, sy, sz]} />
          </mesh>
          <mesh castShadow position={[0, sy + 0.08, 0]} material={accentMaterial}>
            <boxGeometry args={[sx * 1.06, 0.16, sz * 1.06]} />
          </mesh>
        </group>
      );

    case 'box':
    default:
      return (
        <group>
          <mesh castShadow receiveShadow position={[0, sy / 2, 0]} material={material}>
            <boxGeometry args={[sx, sy, sz]} />
          </mesh>
          {sy > 1 && (
            <mesh castShadow position={[0, sy + 0.12, 0]} material={accentMaterial}>
              <boxGeometry args={[sx * 1.04, 0.24, sz * 1.04]} />
            </mesh>
          )}
        </group>
      );
  }
}
