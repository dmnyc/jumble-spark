class PostEditorService extends EventTarget {
  static instance: PostEditorService

  isSuggestionPopupOpen = false

  constructor() {
    super()
    if (!PostEditorService.instance) {
      PostEditorService.instance = this
    }
    return PostEditorService.instance
  }

  closeSuggestionPopup() {
    if (this.isSuggestionPopupOpen) {
      this.isSuggestionPopupOpen = false
      this.dispatchEvent(new CustomEvent('closeSuggestionPopup'))
    }
  }

  /** Opens the main “new note” composer (same as sidebar / write button). Listeners run login check. */
  requestOpenNewPost() {
    this.dispatchEvent(new CustomEvent('requestOpenNewPost'))
  }
}

const instance = new PostEditorService()
export default instance
