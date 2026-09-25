import { assetRegistry } from '../assets/registry.ts';

interface MissingAssetProps {
  readonly assetId: string;
  readonly className?: string;
}

/**
 * DOM counterpart of CG-R-DEBUG: a checker panel carrying the literal missing ID. It renders the
 * real asset only once the verified manifest provides it (no such asset exists at M00).
 */
export function MissingAsset({ assetId, className }: MissingAssetProps) {
  const ref = assetRegistry.resolve(assetId);
  // Only runtime files are served. An approved authored source (assets/source/**) is a reference
  // for derivation, not a shipped image, until its own integration milestone places it in runtime.
  if (ref.status === 'VERIFIED' && ref.path.startsWith('assets/runtime/')) {
    return <img className={className} src={`${import.meta.env.BASE_URL}${ref.path}`} alt="" />;
  }
  if (ref.status === 'VERIFIED') {
    return (
      <div className={`cg-missing ${className ?? ''}`} data-unintegrated-asset={assetId}>
        <span className="cg-missing__label">NOT INTEGRATED {assetId} (approved source only)</span>
      </div>
    );
  }
  return (
    <div className={`cg-missing ${className ?? ''}`} data-missing-asset={assetId}>
      <span className="cg-missing__label">MISSING {assetId}</span>
    </div>
  );
}
