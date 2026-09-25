// CG-R-DEBUG (master Section 17.8): development-only checker body with a literal
// "MISSING <ID>" label. It stands in for an unresolved asset so the gap is conspicuous and can
// never be mistaken for final art. The release asset gate rejects any active placeholder.

import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
} from 'three';

export const DEBUG_RECIPE_ID = 'CG-R-DEBUG';

export interface MissingPlaceholder {
  readonly assetId: string;
  readonly object: Group;
  dispose(): void;
}

function checkerTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas2D unavailable for debug checker texture');
  const cell = size / 8;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      context.fillStyle = (x + y) % 2 === 0 ? '#ff2bd6' : '#1b1b1b';
      context.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function labelTexture(text: string): { texture: CanvasTexture; aspect: number } {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas2D unavailable for debug label texture');
  context.fillStyle = '#000000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffe500';
  context.font = 'bold 64px ui-monospace, Menlo, Consolas, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 32);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { texture, aspect: canvas.width / canvas.height };
}

/** Builds a checker box sized in world units (U) with a billboard label above it. */
export function createMissingPlaceholder(
  assetId: string,
  size: { readonly width: number; readonly height: number; readonly depth: number },
): MissingPlaceholder {
  const group = new Group();
  group.name = `${DEBUG_RECIPE_ID}:${assetId}`;

  const checker = checkerTexture();
  const geometry = new BoxGeometry(size.width, size.height, size.depth);
  const material = new MeshBasicMaterial({ map: checker });
  const body = new Mesh(geometry, material);
  body.position.y = size.height / 2;
  group.add(body);

  const { texture: label, aspect } = labelTexture(`MISSING ${assetId}`);
  const labelMaterial = new SpriteMaterial({ map: label, depthTest: false });
  const sprite = new Sprite(labelMaterial);
  // Labels stay legible at strategic zoom even on small bodies.
  const labelWidth = Math.max(size.width, size.depth, 36) * 1.4;
  sprite.scale.set(labelWidth, labelWidth / aspect, 1);
  sprite.position.y = size.height + labelWidth / aspect;
  sprite.renderOrder = 1;
  group.add(sprite);

  return {
    assetId,
    object: group,
    dispose: () => {
      group.removeFromParent();
      geometry.dispose();
      material.dispose();
      checker.dispose();
      labelMaterial.dispose();
      label.dispose();
    },
  };
}
