import { useState } from 'react'
import * as Icons from 'lucide-react'
import { assetUrl } from '@/lib/api'
import { downloadAsset, makeFilename, downloadAllAsZip } from '@/lib/downloadAsset'

export interface MediaAsset {
  type: 'image' | 'video' | 'audio'
  localPath: string
  provider: string
  generatedAt: string
}

interface MediaFilmstripProps {
  assets: MediaAsset[]
  nodeLabel?: string
  thumbnailHeight?: number
}

function DownloadButton({ onClick, className = '' }: { onClick: (e: React.MouseEvent) => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center rounded bg-black/60 p-1 hover:bg-black/80 transition-colors ${className}`}
      title="Download"
    >
      <Icons.Download className="h-3.5 w-3.5 text-white" />
    </button>
  )
}

function AssetThumbnail({
  asset,
  height,
  nodeLabel,
  index,
  onClick,
}: {
  asset: MediaAsset
  height: number
  nodeLabel: string
  index: number
  onClick: () => void
}) {
  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    downloadAsset(asset.localPath, makeFilename(nodeLabel, asset.localPath, index))
  }

  if (asset.type === 'video') {
    return (
      <div className="relative shrink-0 group" style={{ height, width: height }}>
        <button
          onClick={onClick}
          className="relative overflow-hidden rounded-md border border-border bg-muted transition-opacity hover:opacity-80 h-full w-full"
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
        <div className="absolute top-1.5 right-1.5 hidden group-hover:flex">
          <DownloadButton onClick={handleDownload} />
        </div>
      </div>
    )
  }

  return (
    <div className="relative shrink-0 group" style={{ height, width: height }}>
      <button
        onClick={onClick}
        className="overflow-hidden rounded-md border border-border bg-muted transition-opacity hover:opacity-80 h-full w-full"
        title="Click to view"
      >
        <img src={assetUrl(asset.localPath)} alt="Generated" className="h-full w-full object-cover" />
      </button>
      <div className="absolute top-1.5 right-1.5 hidden group-hover:flex">
        <DownloadButton onClick={handleDownload} />
      </div>
    </div>
  )
}

/**
 * Shared media filmstrip used by Image Generation and Video Generation config panels.
 * Shows thumbnails in a horizontal scroll strip. Clicking opens a full-size modal.
 */
export function MediaFilmstrip({ assets, nodeLabel = 'generated', thumbnailHeight = 200 }: MediaFilmstripProps) {
  const [modalAsset, setModalAsset] = useState<MediaAsset | null>(null)
  const [downloadingAll, setDownloadingAll] = useState(false)

  if (assets.length === 0) return null

  const handleDownloadAll = async () => {
    setDownloadingAll(true)
    try {
      await downloadAllAsZip(assets, nodeLabel)
    } finally {
      setDownloadingAll(false)
    }
  }

  const modalIndex = modalAsset ? assets.indexOf(modalAsset) : 0

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Generated ({assets.length})
          </p>
          {assets.length > 1 && (
            <button
              onClick={handleDownloadAll}
              disabled={downloadingAll}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              {downloadingAll
                ? <Icons.Loader2 className="h-3 w-3 animate-spin" />
                : <Icons.Download className="h-3 w-3" />}
              Download all
            </button>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {assets.map((asset, i) => (
            <AssetThumbnail
              key={i}
              asset={asset}
              height={thumbnailHeight}
              nodeLabel={nodeLabel}
              index={i}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setModalAsset(null)}
        >
          <div
            className="relative flex flex-col items-center gap-3"
            style={{ maxHeight: '95vh', maxWidth: '95vw' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal toolbar */}
            <div className="flex items-center gap-2 self-stretch justify-end">
              <button
                onClick={() => downloadAsset(modalAsset.localPath, makeFilename(nodeLabel, modalAsset.localPath, modalIndex))}
                className="flex items-center gap-1.5 rounded-md bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-medium text-white transition-colors"
              >
                <Icons.Download className="h-3.5 w-3.5" />
                Download
              </button>
              <button
                onClick={() => setModalAsset(null)}
                className="rounded-full bg-white/10 hover:bg-white/20 p-1.5 transition-colors"
              >
                <Icons.X className="h-4 w-4 text-white" />
              </button>
            </div>

            {/* Media */}
            {modalAsset.type === 'video' ? (
              <video
                src={assetUrl(modalAsset.localPath)}
                controls
                autoPlay
                loop
                className="rounded-lg shadow-2xl"
                style={{ maxHeight: '82vh', maxWidth: '95vw', objectFit: 'contain', display: 'block' }}
              />
            ) : (
              <img
                src={assetUrl(modalAsset.localPath)}
                alt="Generated"
                className="rounded-lg shadow-2xl"
                style={{ maxHeight: '82vh', maxWidth: '95vw', objectFit: 'contain', display: 'block' }}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}
