// NEXUS AGENT - RETRY MANAGER

export class RetryManager {
  private static MAX_STEP_RETRIES = 3;

  public static isRetryable(error: string, retryCount: number): boolean {
    if (retryCount >= this.MAX_STEP_RETRIES) return false;

    const nonRetryablePatterns = [
      /unauthorized/i,
      /forbidden/i,
      /requires user approval/i,
      /rejected by user/i,
      /not found/i,
      /invalid url protocol/i,
    ];

    for (const pattern of nonRetryablePatterns) {
      if (pattern.test(error)) return false;
    }

    return true;
  }

  public static async calculateBackoffDelay(retryCount: number): Promise<number> {
    const baseDelay = 1000;
    const maxDelay = 5000;
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
    const jitter = Math.floor(Math.random() * 300);
    const totalDelay = delay + jitter;

    await new Promise((res) => setTimeout(res, totalDelay));
    return totalDelay;
  }
}
