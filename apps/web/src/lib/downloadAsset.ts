import { assetUrl } from './api'

/** Fetch a generated asset and trigger a browser download. */
export async function downloadAsset(localPath: string, filename: string): Promise<void> {
  const res = await fetch(assetUrl(localPath))
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(objectUrl)
}

/** Build a meaningful download filename from the node label, path, and optional index. */
export function makeFilename(nodeLabel: string, localPath: string, index?: number): string {
  const ext = localPath.split('.').pop() ?? 'bin'
  const date = new Date().toISOString().split('T')[0]
  const slug = nodeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const suffix = index !== undefined && index > 0 ? `-${index + 1}` : ''
  return `${slug}${suffix}-${date}.${ext}`
}

/** Fetch all assets and download them as a single zip archive. */
export async function downloadAllAsZip(
  assets: { localPath: string }[],
  nodeLabel: string
): Promise<void> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const date = new Date().toISOString().split('T')[0]
  const slug = nodeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  await Promise.all(
    assets.map(async (asset, i) => {
      const ext = asset.localPath.split('.').pop() ?? 'bin'
      const res = await fetch(assetUrl(asset.localPath))
      const blob = await res.blob()
      zip.file(`${slug}-${i + 1}.${ext}`, blob)
    })
  )

  const content = await zip.generateAsync({ type: 'blob' })
  const objectUrl = URL.createObjectURL(content)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = `${slug}-${date}.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(objectUrl)
}
