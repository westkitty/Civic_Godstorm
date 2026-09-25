export interface BuildIdentity {
  readonly version: string;
  readonly commit: string;
  readonly contract: string;
}

declare const __CG_BUILD__: BuildIdentity;

export const buildIdentity: BuildIdentity = __CG_BUILD__;
