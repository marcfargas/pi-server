/**
 * Extension UI Bridge
 *
 * Routes extension UI requests from pi to the connected rw client.
 * Handles timeout when no client is connected or client doesn't respond.
 *
 * Fire-and-forget methods (notify, setStatus, setWidget, setTitle, set_editor_text)
 * are broadcast directly — no response needed.
 *
 * Dialog methods (select, confirm, input, editor) require a response from the
 * rw client. If no response within timeout, a default response is sent to pi.
 */

const FIRE_AND_FORGET_METHODS = new Set([
  "notify",
  "setStatus",
  "setWidget",
  "setTitle",
  "set_editor_text",
]);

export interface PendingUIRequest {
  id: string;
  method: string;
  timeoutId: ReturnType<typeof setTimeout>;
  resolve: (response: Record<string, unknown>) => void;
}

export class UIBridge {
  private pendingRequests = new Map<string, PendingUIRequest>();
  private timeoutMs: number;

  constructor(timeoutMs: number = 60_000) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Check if a pi stdout message is an extension UI request.
   */
  isExtensionUIRequest(message: Record<string, unknown>): boolean {
    return message.type === "extension_ui_request";
  }

  /**
   * Check if this is a fire-and-forget UI method (no response needed).
   */
  isFireAndForget(message: Record<string, unknown>): boolean {
    return FIRE_AND_FORGET_METHODS.has(message.method as string);
  }

  /**
   * Register a dialog request that needs a client response.
   * Returns a Promise that resolves when the client responds or timeout fires.
   *
   * The caller (relay) should:
   * 1. Forward the request to the rw client
   * 2. Call handleResponse() when the client responds
   *
   * If no response within timeout, the returned Promise resolves with a
   * default "cancelled" response, which is sent back to pi.
   */
  registerRequest(id: string, method: string): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve(this.getDefaultResponse(id, method));
      }, this.timeoutMs);

      this.pendingRequests.set(id, { id, method, timeoutId, resolve });
    });
  }

  /**
   * Handle a response from the client for a pending UI request.
   * Returns true if the response was matched to a pending request.
   */
  handleResponse(id: string, response: Record<string, unknown>): boolean {
    const pending = this.pendingRequests.get(id);
    if (!pending) return false;

    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(id);
    pending.resolve(response);
    return true;
  }

  /**
   * Check if there are pending UI requests waiting for responses.
   */
  hasPendingRequests(): boolean {
    return this.pendingRequests.size > 0;
  }

  /**
   * Cancel all pending requests (e.g., on client disconnect).
   * Sends default responses to pi so extensions don't hang.
   */
  cancelAll(): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.resolve(this.getDefaultResponse(id, pending.method));
    }
    this.pendingRequests.clear();
  }

  /**
   * Get the default response for a timed-out or cancelled dialog.
   * Mimics what pi returns when the user presses Escape.
   */
  private getDefaultResponse(id: string, method: string): Record<string, unknown> {
    switch (method) {
      case "select":
        return { type: "extension_ui_response", id, cancelled: true };
      case "confirm":
        return { type: "extension_ui_response", id, confirmed: false };
      case "input":
        return { type: "extension_ui_response", id, cancelled: true };
      case "editor":
        return { type: "extension_ui_response", id, cancelled: true };
      default:
        return { type: "extension_ui_response", id, cancelled: true };
    }
  }
}
