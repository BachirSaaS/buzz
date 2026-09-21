/** Public owner-session projection. No credential, signer or secret is serializable here. */
export type OwnerSnapshot = {
  signedIn: boolean; owner?: string; boundOwner?: string; relay?: string;
  desktop: 'unknown' | 'available' | 'unavailable'; desktopReason: string;
  phase: 'idle' | 'busy' | 'error'; message: string; secretLength: number;
};
export type OwnerRequest = { action: 'probe' | 'signin-nsec' | 'signin-desktop' | 'signout'; relay?: string };
export interface OwnerClient {
  snapshot(): OwnerSnapshot;
  subscribe(listener: (snapshot: OwnerSnapshot) => void): () => void;
  request(request: OwnerRequest): Promise<boolean>;
  secret(action: 'append' | 'backspace' | 'clear', value?: string): void;
  cancel(): void;
  dispose(): void;
}
