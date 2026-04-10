import { useState } from 'react'
import * as Icons from 'lucide-react'
import { assetUrl } from '@/lib/api'

export interface MediaAsset {
  type: 'image' | 'video' | 'audio'
  localPath: string
  provider: string
  generatedAt: string
}

interface MediaFilmstripProps {
  assets: MediaAsset[]
  thumbnailHeight?: number
}

function AssetThumbnail({ asset, height, onClick }: { asset: MediaAsset; height: number; onClick: () => void }) {
  if (asset.type === 'video') {
    return (
      <button
        onClick={onClick}
        className="relative overflow-hidden rounded-md border border-border bg-muted transition-opacity hover:opacity-80 shrink-0"
        style={{ height, width: height }}
        title="Click to view"
      >
        <video
          src={assetUrl(asset.localPath)}
          autoPlay
          loop
          muted
          playsInline
          className="h-full w-full object-cover"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-black/40 p-1.5">
            <Icons.Play className="h-4 w-4 text-white" />
          </div>
        </div>
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      className="overflow-hidden rounded-md border border-border bg-muted transition-opacity hover:opacity-80 shrink-0"
      style={{ height, width: height }}
      title="Click to view"
    >
      <img src={assetUrl(asset.localPath)} alt="Generated" className="h-full w-full object-cover" />
    </button>
  )
}

/**
 * Shared media filmstrip used by Image Generation and Video Generation config panels.
 * Shows thumbnails in a horizontal scroll strip. Clicking opens a full-size modal.
 */
export function MediaFilmstrip({ assets, thumbnailHeight = 200 }: MediaFilmstripProps) {
  const [modalAsset, setModalAsset] = useState<MediaAsset | null>(null)

  if (assets.length === 0) return null

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Generated ({assets.length})
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {assets.map((asset, i) => (
            <AssetThumbnail
              key={i}
              asset={asset}
              height={thumbnailHeight}
              onClick={() => setModalAsset(asset)}
            />
          ))}
        </div>
        <p className="text-[9px] text-muted-foreground/60">
          {new Date(assets[0].generatedAt).toLocaleString()} · via {assets[0].provider}
        </p>
      </div>

      {/* Full-size modal */}
      {modalAsset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setModalAsset(null)}
        >
          <div
            className="relative"
            style={{ maxHeight: '90vh', maxWidth: '90vw' }}
            onClick={(e) => e.stopPropagation()}
          >
            {modalAsset.type === 'video' ? (
              <video
                src={assetUrl(modalAsset.localPath)}
                controls
                autoPlay
                loop
                className="rounded-lg shadow-2xl"
                style={{ maxHeight: '90vh', maxWidth: '90vw', objectFit: 'contain', display: 'block' }}
              />
            ) : (
              <img
                src={assetUrl(modalAsset.localPath)}
                alt="Generated"
                className="rounded-lg shadow-2xl"
                style={{ maxHeight: '90vh', maxWidth: '90vw', objectFit: 'contain', display: 'block' }}
              />
            )}
            <button
              onClick={() => setModalAsset(null)}
              className="absolute -right-3 -top-3 rounded-full bg-white p-1.5 shadow-lg hover:bg-gray-100"
            >
              <Icons.X className="h-4 w-4 text-black" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
