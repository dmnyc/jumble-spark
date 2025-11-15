import { ExtendedKind } from '@/constants'

/**
 * Get the appropriate event kind for a media file based on its type and duration
 * @param file - The file to analyze
 * @param isReply - Whether this is a reply/comment
 * @returns The event kind number
 */
export async function getMediaKindFromFile(file: File, isReply: boolean = false): Promise<number> {
  const fileType = file.type
  const fileName = file.name.toLowerCase()
  
  // Check if it's an image
  if (fileType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|heic|avif|apng)$/i.test(fileName)) {
    return ExtendedKind.PICTURE // kind 20
  }
  
  // Check if it's audio or video
  // mp4, m4a, and webm files can be either audio or video, so check MIME type first
  // Mobile browsers may report m4a files as audio/m4a, audio/mp4, audio/x-m4a, or even video/mp4
  const isAudioMime = fileType.startsWith('audio/') || fileType === 'audio/mp4' || fileType === 'audio/x-m4a' || fileType === 'audio/m4a' || fileType === 'audio/webm' || fileType === 'audio/mpeg'
  const isVideoMime = fileType.startsWith('video/')
  const isAudioExt = /\.(mp3|m4a|ogg|wav|opus|aac|flac|mpeg|mp4)$/i.test(fileName)
  const isVideoExt = /\.(mp4|ogg|mov|avi|mkv|m4v)$/i.test(fileName)
  
  // m4a files are always audio, even if MIME type is video/mp4 (mobile browsers sometimes report this)
  const isM4aFile = /\.m4a$/i.test(fileName)
  // mp4 files: check MIME type to determine if audio or video
  const isMp4Audio = /\.mp4$/i.test(fileName) && isAudioMime
  const isWebmAudio = /\.webm$/i.test(fileName) && isAudioMime
  const isWebmVideo = /\.webm$/i.test(fileName) && isVideoMime
  
  const isAudio = isAudioMime || isAudioExt || isM4aFile || isMp4Audio || isWebmAudio
  const isVideo = isVideoMime || (isVideoExt && !isM4aFile && !isMp4Audio) || isWebmVideo
  
  if (isAudio || isVideo) {
    // Get duration for audio/video files
    const duration = await getMediaDuration(file)
    
    if (isAudio) {
      // Audio mp4/m4a files longer than 60 seconds should be treated as video (for new posts only)
      if (!isReply && (fileType === 'audio/mp4' || fileType === 'audio/x-m4a' || fileName.endsWith('.m4a') || fileName.endsWith('.mp4')) && duration > 60) {
        // Determine if it should be long or short video based on duration
        return duration > 600 ? ExtendedKind.VIDEO : ExtendedKind.SHORT_VIDEO
      }
      
      // Audio files <= 60 seconds, or any audio in replies
      return isReply ? ExtendedKind.VOICE_COMMENT : ExtendedKind.VOICE
    }
    
    if (isVideo) {
      // Video files longer than 10 minutes (600 seconds) are long videos
      return duration > 600 ? ExtendedKind.VIDEO : ExtendedKind.SHORT_VIDEO
    }
  }
  
  // Default: treat as picture if we can't determine
  return ExtendedKind.PICTURE
}

/**
 * Get the duration of a media file in seconds
 * @param file - The file to analyze
 * @returns Duration in seconds, or 0 if unable to determine
 */
function getMediaDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const media = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video')
    
    media.onloadedmetadata = () => {
      const duration = media.duration || 0
      URL.revokeObjectURL(url)
      resolve(duration)
    }
    
    media.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(0)
    }
    
    media.src = url
    media.load()
    
    // Timeout after 5 seconds
    setTimeout(() => {
      URL.revokeObjectURL(url)
      resolve(0)
    }, 5000)
  })
}

