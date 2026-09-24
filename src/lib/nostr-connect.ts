import { isElectron } from './platform'

export function getNostrConnectClientMetadata(): { name: string; url?: string } {
  if (isElectron()) {
    return {
      name: 'Jumble(Desktop)'
    }
  }

  return {
    name: document.location.host,
    url: document.location.origin
  }
}
