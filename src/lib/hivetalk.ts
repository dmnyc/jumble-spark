import { HIVETALK_BASE_URL } from '@/constants'

export interface HiveTalkJoinParams {
  room: string
  name: string
  roomPassword?: string
  audio?: boolean
  video?: boolean
  screen?: boolean
  notify?: boolean
  hide?: boolean
  token?: string
}

/**
 * Build a HiveTalk direct-join URL. See https://github.com/HiveTalk/hivetalksfu#direct-join
 */
export function buildHiveTalkJoinUrl(params: HiveTalkJoinParams): string {
  const url = new URL('/join', HIVETALK_BASE_URL)
  url.searchParams.set('room', params.room)
  url.searchParams.set('name', params.name)
  url.searchParams.set('roomPassword', params.roomPassword ?? '0')
  url.searchParams.set('audio', params.audio !== false ? '1' : '0')
  url.searchParams.set('video', params.video !== false ? '1' : '0')
  url.searchParams.set('screen', params.screen ? '1' : '0')
  url.searchParams.set('notify', params.notify !== false ? '1' : '0')
  if (params.hide !== undefined) url.searchParams.set('hide', params.hide ? '1' : '0')
  if (params.token) url.searchParams.set('token', params.token)
  return url.toString()
}

/** Deterministic room id for a 1:1 call between two pubkeys (same room from either side). */
export function roomIdForPubkeys(pubkeyA: string, pubkeyB: string): string {
  const [a, b] = [pubkeyA, pubkeyB].sort()
  const shortA = a.slice(0, 8)
  const shortB = b.slice(0, 8)
  return `jumble-${shortA}-${shortB}`
}
