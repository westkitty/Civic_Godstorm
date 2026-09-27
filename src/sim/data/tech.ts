// Technology graph and Policy definitions (master Section 7.1, 7.2).
// 24 technologies across 6 branches and 4 tiers. 12 policies across 6 axes.

import { units } from '../core/quantity.ts';

export const TECH_BRANCHES = ['PRO', 'NET', 'INS', 'ANA', 'ENG', 'ECO'] as const;
export type TechBranch = (typeof TECH_BRANCHES)[number];

export const TIER_COSTS = {
  1: units(60),
  2: units(140),
  3: units(300),
  4: units(600),
} as const;

export interface Technology {
  readonly id: string;
  readonly name: string;
  readonly branch: TechBranch;
  readonly tier: 1 | 2 | 3 | 4;
  readonly cost: number;
  readonly prerequisites: readonly string[];
  readonly effect: string;
}

export const TECHNOLOGIES: readonly Technology[] = [
  // PRO: Production / Provisions
  { id: 'T-PRO-1', name: 'Stored Harvest', branch: 'PRO', tier: 1, cost: TIER_COSTS[1], prerequisites: [], effect: 'GRANARY; +40 base FOOD storage' },
  { id: 'T-PRO-2', name: 'Rotational Fields', branch: 'PRO', tier: 2, cost: TIER_COSTS[2], prerequisites: ['T-PRO-1', 'T-ECO-1'], effect: 'Replant mode; farm depletion halved' },
  { id: 'T-PRO-3', name: 'Public Health', branch: 'PRO', tier: 3, cost: TIER_COSTS[3], prerequisites: ['T-PRO-2', 'T-INS-2'], effect: 'INFIRMARY alternative non-BIO recipe output doubled' },
  { id: 'T-PRO-4', name: 'Civic Abundance', branch: 'PRO', tier: 4, cost: TIER_COSTS[4], prerequisites: ['T-PRO-3', 'T-ENG-3'], effect: 'GREAT-WEIR project; food reserve distribution priority tools' },

  // NET: Networks / Logistics
  { id: 'T-NET-1', name: 'Surveyed Roads', branch: 'NET', tier: 1, cost: TIER_COSTS[1], prerequisites: [], effect: 'Grade-1 ROAD, DEPOT; transport routes' },
  { id: 'T-NET-2', name: 'Waterways', branch: 'NET', tier: 2, cost: TIER_COSTS[2], prerequisites: ['T-NET-1', 'T-ENG-1'], effect: 'DOCK, BRIDGE, merchant hull; GF-WEBBED/GF-PADDLE' },
  { id: 'T-NET-3', name: 'Godways', branch: 'NET', tier: 3, cost: TIER_COSTS[3], prerequisites: ['T-NET-2', 'T-ENG-2'], effect: 'Reinforced road/bridge capacity; portable settlements' },
  { id: 'T-NET-4', name: 'Continental Exchange', branch: 'NET', tier: 4, cost: TIER_COSTS[4], prerequisites: ['T-NET-3', 'T-INS-3'], effect: 'EXCHANGE project; convoy capacity 30 instead of 20' },

  // INS: Institutions / Governance
  { id: 'T-INS-1', name: 'Common Records', branch: 'INS', tier: 1, cost: TIER_COSTS[1], prerequisites: [], effect: 'ARCHIVE; public claims and treaty ledger' },
  { id: 'T-INS-2', name: 'Civic Charters', branch: 'INS', tier: 2, cost: TIER_COSTS[2], prerequisites: ['T-INS-1', 'T-PRO-1'], effect: 'Six policy slots; gallery cultivation; organized evacuation' },
  { id: 'T-INS-3', name: 'Plural Institutions', branch: 'INS', tier: 3, cost: TIER_COSTS[3], prerequisites: ['T-INS-2', 'T-NET-2'], effect: 'Policy transition cost -25%; refugee integration rate doubled' },
  { id: 'T-INS-4', name: 'World Compact', branch: 'INS', tier: 4, cost: TIER_COSTS[4], prerequisites: ['T-INS-3', 'T-NET-3'], effect: 'Commonworld ratification; shared historical archive' },

  // ANA: Anatomy / Godforms
  { id: 'T-ANA-1', name: 'Observation', branch: 'ANA', tier: 1, cost: TIER_COSTS[1], prerequisites: [], effect: 'Detailed own-body regions; GF-VIBRATION' },
  { id: 'T-ANA-2', name: 'Comparative Anatomy', branch: 'ANA', tier: 2, cost: TIER_COSTS[2], prerequisites: ['T-ANA-1', 'T-PRO-1'], effect: 'GF-GILLS/SHELL/CROWN; fracture treatment' },
  { id: 'T-ANA-3', name: 'Directed Cultivation', branch: 'ANA', tier: 3, cost: TIER_COSTS[3], prerequisites: ['T-ANA-2', 'T-ECO-2'], effect: 'GF-AERIAL/METABOLIC; membrane regrowth' },
  { id: 'T-ANA-4', name: 'Living Archives', branch: 'ANA', tier: 4, cost: TIER_COSTS[4], prerequisites: ['T-ANA-3', 'T-PRO-3'], effect: 'GF-OSSIFY; civic medicine grants +5 longevity support while supplied' },

  // ENG: Engineering / Works
  { id: 'T-ENG-1', name: 'Braced Works', branch: 'ENG', tier: 1, cost: TIER_COSTS[1], prerequisites: [], effect: 'WORKSHOP, MINE, WALL; support stress overlay' },
  { id: 'T-ENG-2', name: 'Deep Foundations', branch: 'ENG', tier: 2, cost: TIER_COSTS[2], prerequisites: ['T-ENG-1', 'T-NET-1'], effect: 'CANAL; GF-BURROW; support cradles' },
  { id: 'T-ENG-3', name: 'Counterweight Defense', branch: 'ENG', tier: 3, cost: TIER_COSTS[3], prerequisites: ['T-ENG-2', 'T-ANA-2'], effect: 'BALLISTA, war hull, anti-God bracing' },
  { id: 'T-ENG-4', name: 'Monumental Systems', branch: 'ENG', tier: 4, cost: TIER_COSTS[4], prerequisites: ['T-ENG-3', 'T-INS-3'], effect: 'WORLD-OBSERVATORY project; repair work -25%' },

  // ECO: Ecology / Biosphere
  { id: 'T-ECO-1', name: 'Habitat Survey', branch: 'ECO', tier: 1, cost: TIER_COSTS[1], prerequisites: [], effect: 'Biomass forecast, sanctuary zoning' },
  { id: 'T-ECO-2', name: 'Managed Ecologies', branch: 'ECO', tier: 2, cost: TIER_COSTS[2], prerequisites: ['T-ECO-1', 'T-PRO-1'], effect: 'GF-COAT/PHOTOSYNTH/ROOT; watershed monitoring' },
  { id: 'T-ECO-3', name: 'Symbiotic Industry', branch: 'ECO', tier: 3, cost: TIER_COSTS[3], prerequisites: ['T-ECO-2', 'T-ANA-2'], effect: 'GF-VENT/GROVE; sustainable BIO harvesting' },
  { id: 'T-ECO-4', name: 'Succession Science', branch: 'ECO', tier: 4, cost: TIER_COSTS[4], prerequisites: ['T-ECO-3', 'T-PRO-3'], effect: 'Corpse contamination control, finite fossil study' },
];

export const TECH_BY_ID = new Map<string, Technology>(TECHNOLOGIES.map((t) => [t.id, t]));

export function canResearchTech(completed: readonly string[], techId: string): boolean {
  if (completed.includes(techId)) return false;
  const tech = TECH_BY_ID.get(techId);
  if (!tech) return false;
  return tech.prerequisites.every((prereq) => completed.includes(prereq));
}

// 7.2 Policies
export const POLICY_AXES = [
  'RESOURCE_ETHICS',
  'CULTURAL_LEGITIMACY',
  'SECURITY',
  'AUTHORITY',
  'SERVICE_OWNERSHIP',
  'SETTLEMENT_FORM',
] as const;
export type PolicyAxis = (typeof POLICY_AXES)[number];

export const POLICY_CHOICES = {
  RESOURCE_ETHICS: ['NEUTRAL', 'P-STEWARDSHIP', 'P-EXTRACTION'] as const,
  CULTURAL_LEGITIMACY: ['NEUTRAL', 'P-PILGRIMAGE', 'P-SECULAR'] as const,
  SECURITY: ['NEUTRAL', 'P-MILITARIZE', 'P-SANCTUARY'] as const,
  AUTHORITY: ['NEUTRAL', 'P-DIVINE-CHARTER', 'P-CIVIC-CHARTER'] as const,
  SERVICE_OWNERSHIP: ['NEUTRAL', 'P-DIVINE-UTILITY', 'P-REDUNDANCY'] as const,
  SETTLEMENT_FORM: ['NEUTRAL', 'P-FIXED-TENURE', 'P-MOBILE-CHARTER'] as const,
} as const;

export type PolicyChoice =
  | 'NEUTRAL'
  | 'P-STEWARDSHIP'
  | 'P-EXTRACTION'
  | 'P-PILGRIMAGE'
  | 'P-SECULAR'
  | 'P-MILITARIZE'
  | 'P-SANCTUARY'
  | 'P-DIVINE-CHARTER'
  | 'P-CIVIC-CHARTER'
  | 'P-DIVINE-UTILITY'
  | 'P-REDUNDANCY'
  | 'P-FIXED-TENURE'
  | 'P-MOBILE-CHARTER';

export const POLICY_COST_COIN = 20;
export const POLICY_COOLDOWN_TURNS = 10;
