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
  const isAudio = fileType.startsWith('audio/') || /\.(mp3|m4a|ogg|wav|webm|opus|aac|flac)$/i.test(fileName)
  const isVideo = fileType.startsWith('video/') || /\.(mp4|webm|ogg|mov|avi|mkv|m4v)$/i.test(fileName)
  
  if (isAudio || isVideo) {
    // Get duration for audio/video files
    const duration = await getMediaDuration(file)
    
    if (isAudio) {
      // Audio mp4 files longer than 60 seconds should be treated as video
      if ((fileType === 'audio/mp4' || fileName.endsWith('.m4a')) && duration > 60) {
        // Determine if it should be long or short video based on duration
        return duration > 600 ? ExtendedKind.VIDEO : ExtendedKind.SHORT_VIDEO
      }
      
      // Audio files <= 60 seconds
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

