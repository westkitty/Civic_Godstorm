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
  if (ref.status === 'VERIFIED') {
    return <img className={className} src={`${import.meta.env.BASE_URL}${ref.path}`} alt="" />;
  }
  return (
    <div className={`cg-missing ${className ?? ''}`} data-missing-asset={assetId}>
      <span className="cg-missing__label">MISSING {assetId}</span>
    </div>
  );
}
