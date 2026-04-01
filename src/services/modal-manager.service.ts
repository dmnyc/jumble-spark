import logger from '@/lib/logger'

class ModalManagerService {
  static instance: ModalManagerService

  private modals: { id: string; cb: () => void }[] = []

  constructor() {
    if (!ModalManagerService.instance) {
      ModalManagerService.instance = this
    }
    return ModalManagerService.instance
  }

  register(id: string, cb: () => void) {
    const modal = this.modals.find((m) => m.id === id)
    if (modal) {
      // already registered, update callback
      modal.cb = cb
      logger.info('[LightboxTrace][ModalManager] updated modal callback', {
        id,
        modalCount: this.modals.length
      })
      return
    }
    this.modals.push({ id, cb })
    logger.info('[LightboxTrace][ModalManager] register', {
      id,
      modalCount: this.modals.length
    })
  }

  unregister(id: string) {
    const modal = this.modals.find((m) => m.id === id)
    if (!modal) return

    modal.cb()
    this.modals = this.modals.filter((m) => m.id !== id)
    logger.info('[LightboxTrace][ModalManager] unregister', {
      id,
      modalCount: this.modals.length
    })
  }

  pop() {
    const modal = this.modals.pop()
    if (!modal) {
      logger.info('[LightboxTrace][ModalManager] pop noop', { modalCount: this.modals.length })
      return false
    }

    modal.cb()
    logger.info('[LightboxTrace][ModalManager] pop close', {
      id: modal.id,
      modalCount: this.modals.length
    })
    return true
  }
}

const instance = new ModalManagerService()
export default instance
