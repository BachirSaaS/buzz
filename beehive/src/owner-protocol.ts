/** Public owner-session projection. No credential, signer or secret is serializable here. */
export type HostSnapshot = { name: string; host: string; owner: string; relay: string; state: 'running' | 'stopped' | 'unknown'; agents?: number; connection?: string; instance?: string; revision: string; resetPending: boolean };
export type OwnerSnapshot = {
  host?: HostSnapshot; hostPhase?: 'idle' | 'busy' | 'error'; hostMessage?: string;
  signedIn: boolean; owner?: string; boundOwner?: string; relay?: string;
  desktop: 'unknown' | 'available' | 'unavailable'; desktopReason: string;
  phase: 'idle' | 'busy' | 'error'; message: string; secretLength: number;
};
export type OwnerRequest = { action: 'probe' | 'signin-nsec' | 'signin-desktop' | 'signout' | 'host-status' | 'host-start' | 'host-stop' | 'host-reset'; relay?: string; revision?: string; instance?: string; confirmed?: boolean };
export interface OwnerClient {
  snapshot(): OwnerSnapshot;
  subscribe(listener: (snapshot: OwnerSnapshot) => void): () => void;
  request(request: OwnerRequest): Promise<boolean>;
  secret(action: 'append' | 'backspace' | 'clear', value?: string): void;
  cancel(): void;
  dispose(): void;
}
