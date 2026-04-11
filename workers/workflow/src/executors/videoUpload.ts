import { NodeExecutor, type NodeExecutionContext, type NodeExecutionResult } from './base.js'

interface VideoFile {
  id: string
  name: string
  storageKey: string
}

/** Simple source executor — validates the uploaded video and passes its file reference downstream. */
export class VideoUploadExecutor extends NodeExecutor {
  async execute(
    _input: unknown,
    config: Record<string, unknown>,
    _ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult> {
    const videoFiles = (config.video_files as VideoFile[]) ?? []

    if (videoFiles.length === 0) {
      throw new Error('Video Upload: no video file configured — upload a video in the node config')
    }

    const file = videoFiles[0]

    if (!file.storageKey) {
      throw new Error('Video Upload: the video file was not uploaded successfully — try uploading again')
    }

    return {
      output: {
        storageKey: file.storageKey,
        filename:   file.name,
        localPath:  `/files/${file.storageKey}`,
        // text field makes it legible if it flows into an AI node directly
        text: `Video file: ${file.name}`,
      },
    }
  }
}
