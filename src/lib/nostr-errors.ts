/** Login dialog is already opened; callers should not treat this as an application failure. */
export class LoginRequiredError extends Error {
  constructor(message = 'LOGIN_REQUIRED') {
    super(message)
    this.name = 'LoginRequiredError'
  }
}
