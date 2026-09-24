import { LINK_PREVIEW_SERVER } from '@/constants'
import { BoundedMap } from '@/lib/bounded-map'
import { proxyFetch } from '@/lib/proxy-fetch'
import { TWebMetadata } from '@/types'
import DataLoader from 'dataloader'

class WebService {
  static instance: WebService

  private webMetadataDataLoader = new DataLoader<string, TWebMetadata>(
    async (keys) => {
      return await Promise.all(keys.map((url) => this.fetchOne(url)))
    },
    {
      maxBatchSize: 1,
      cacheMap: new BoundedMap<string, Promise<TWebMetadata>>({ maxSize: 1_000 })
    }
  )

  constructor() {
    if (!WebService.instance) {
      WebService.instance = this
    }
    return WebService.instance
  }

  async fetchWebMetadata(url: string) {
    return await this.webMetadataDataLoader.load(url)
  }

  private async fetchOne(url: string): Promise<TWebMetadata> {
    try {
      const res = await proxyFetch(`${LINK_PREVIEW_SERVER}/?url=${encodeURIComponent(url)}`, {
        headers: { accept: 'application/json' }
      })
      if (!res.ok) return {}

      const data = JSON.parse(res.body) as Partial<Record<string, string | null>>

      return {
        title: data.title,
        description: data.description,
        image: data.image
      }
    } catch {
      return {}
    }
  }
}

const instance = new WebService()

export default instance
