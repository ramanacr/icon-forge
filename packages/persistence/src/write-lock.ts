export class ProjectWriteLock {
  private readonly name: string;
  private readonly channel: BroadcastChannel;
  private readonly flush: () => Promise<void>;
  private state: 'writer' | 'readonly' = 'readonly';
  private releaseHeld: (() => void) | null = null;
  private heldRequest: Promise<void> | null = null;

  private constructor(projectId: string, flush: () => Promise<void>) {
    this.name = `iconforge:project:${projectId}`;
    this.flush = flush;
    this.channel = new BroadcastChannel(this.name);
    this.channel.addEventListener('message', event => { void this.onMessage(event.data); });
  }

  static async open(projectId: string, flush: () => Promise<void>): Promise<ProjectWriteLock> {
    if (!navigator.locks || !globalThis.BroadcastChannel) throw new TypeError('project-lock.unsupported');
    const instance = new ProjectWriteLock(projectId, flush);
    await instance.tryAcquire();
    return instance;
  }

  get mode(): 'writer' | 'readonly' { return this.state; }

  private async tryAcquire(): Promise<boolean> {
    let decide!: (value: boolean) => void;
    let fail!: (error: unknown) => void;
    const acquired = new Promise<boolean>((resolve, reject) => { decide = resolve; fail = reject; });
    this.heldRequest = navigator.locks.request(this.name, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) { decide(false); return; }
      this.state = 'writer';
      decide(true);
      await new Promise<void>(resolve => { this.releaseHeld = resolve; });
    });
    void this.heldRequest.catch(fail);
    return acquired;
  }

  private async release(): Promise<void> {
    this.releaseHeld?.();
    this.releaseHeld = null;
    await this.heldRequest;
    this.heldRequest = null;
    this.state = 'readonly';
  }

  private async onMessage(data: unknown): Promise<void> {
    if (typeof data !== 'object' || data === null || !('type' in data) || data.type !== 'takeover' || this.state !== 'writer') return;
    try {
      await this.flush();
      await this.release();
      this.channel.postMessage({ type: 'released' });
    } catch {
      this.channel.postMessage({ type: 'denied' });
    }
  }

  async takeOver(): Promise<boolean> {
    if (this.state === 'writer') return true;
    const released = await new Promise<boolean>(resolve => {
      const listener = (event: MessageEvent): void => {
        if (event.data?.type !== 'released' && event.data?.type !== 'denied') return;
        clearTimeout(timeout);
        this.channel.removeEventListener('message', listener);
        resolve(event.data.type === 'released');
      };
      const timeout = setTimeout(() => { this.channel.removeEventListener('message', listener); resolve(false); }, 5_000);
      this.channel.addEventListener('message', listener);
      this.channel.postMessage({ type: 'takeover' });
    });
    return released ? this.tryAcquire() : false;
  }

  async close(): Promise<void> {
    if (this.state === 'writer') await this.release();
    this.channel.close();
  }
}
