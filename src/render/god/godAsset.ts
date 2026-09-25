// Resolves and loads the first Q God model (only its GLB is bundled) for the map (M03 on-map scale and contact proof).
// Resolution order is fixed: a VERIFIED manifest entry, then a derived CANDIDATE recorded in
// provenance with its hash (conspicuously labelled as unapproved), otherwise MISSING (the caller keeps
// the CG-R-DEBUG placeholder). A loaded file whose SHA-256 differs from its record is rejected, never
// shown.

import type { Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import provenance from '../../../assets/provenance.json';
import { assetRegistry } from '../../assets/registry.ts';

export const FORM_Q_ID = 'CG-D-GOD-FORM-Q';

const MODEL_URLS = import.meta.glob('../../../assets/runtime/models/cg_d_god_form_q.glb', { query: '?url', import: 'default', eager: true });

export interface GodModelResolution {
  readonly id: string;
  readonly status: 'VERIFIED' | 'CANDIDATE' | 'MISSING';
  readonly url: string | null;
  readonly sha256: string | null;
  readonly revision: string | null;
}

interface DerivedRecord {
  readonly id: string;
  readonly status: string;
  readonly path?: string;
  readonly sha256?: string;
  readonly revision?: string;
}

function urlFor(path: string): string | null {
  const key = Object.keys(MODEL_URLS).find((k) => k.endsWith(`/${path}`) || path.endsWith(k.replace(/^(\.\.\/)+/, '')));
  return key ? (MODEL_URLS[key] ?? null) : null;
}

export function resolveGodModel(id: string = FORM_Q_ID): GodModelResolution {
  const ref = assetRegistry.resolve(id);
  const record = (provenance.records as DerivedRecord[]).find((r) => r.id === id);
  if (ref.status === 'VERIFIED') return { id, status: 'VERIFIED', url: urlFor(ref.path), sha256: record?.sha256 ?? null, revision: record?.revision ?? null };
  if (record?.status === 'DERIVED_UNVERIFIED' && record.path && record.sha256) {
    const url = urlFor(record.path);
    if (url) return { id, status: 'CANDIDATE', url, sha256: record.sha256, revision: record.revision ?? null };
  }
  return { id, status: 'MISSING', url: null, sha256: null, revision: null };
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface LoadedGodModel {
  readonly resolution: GodModelResolution;
  /** A fresh skinned copy (own skeleton) of the loaded scene. */
  instantiate(): Object3D;
}

export async function loadGodModel(resolution: GodModelResolution): Promise<LoadedGodModel> {
  if (!resolution.url || resolution.status === 'MISSING') throw new Error(`${resolution.id} is MISSING`);
  const response = await fetch(resolution.url);
  if (!response.ok) throw new Error(`${resolution.id}: HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (resolution.sha256 && (await sha256Hex(buffer)) !== resolution.sha256) {
    throw new Error(`${resolution.id}: file hash does not match its record; refusing to display it`);
  }
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  return { resolution, instantiate: () => cloneSkinned(gltf.scene) };
}
