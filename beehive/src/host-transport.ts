import { privateExchange, signSuccessor, verifySuccessors } from './private-handoff.ts';
import type { Assignment, Grant } from './handoff.ts';
import { connectNostr } from './nostr-client.ts';
import { hostPairing, type HostPairing, type HostRegistration } from './host-registration.ts';
import { message, publicKey, type Message } from './protocol.ts';

/** Local host configuration pins the command signer, not an owner endorsement.
 * Legacy registration wrappers are compatibility input only (public history).
 * No agent grant is manufactured; retained per-agent journals remain authoritative.
 */
export function privateHostTransport(configuration: HostPairing | HostRegistration, secret: string) {
  const retained = { request: hostPairing('request' in configuration ? configuration.request : configuration) };
  if (publicKey(secret) !== retained.request.host) throw Error('Wrong infrastructure signer');
  let connected = false;
  return {
    signGrant: (grant: Grant) => signSuccessor(grant, secret, retained.request.relay),
    verifyAssignment: (current: Assignment, next: Assignment) => verifySuccessors(current, next, retained.request.relay),
    get connected() { return connected; },
    availability: () => message('availability', retained.request.host, '', 0, { configuration: retained.request, observedAt: Date.now() }),
    binding: { host: retained.request.host, owner: retained.request.owner },
    validate(url: string) {
      if (url !== retained.request.relay) throw Error('Wrong host relay');
    },
    connect(url: string, _legacyOwnerSecret: string, receive: (m: Message) => void, _recovered?: () => void) {
      this.validate(url);
      const wire = connectNostr(url, Buffer.from(secret, 'hex'), input => {
        const m = input.message;
        if (['prepare', 'prepared', 'grant'].includes(m.type)) {
          let authenticated: Message;
          try { authenticated = privateExchange(input, retained.request.owner, retained.request.host); } catch { return; }
          receive(authenticated);
          return;
        }
        if (input.sender !== retained.request.owner || m.host !== retained.request.host || !['authorize-move','enroll','metadata', 'inspect', 'save', 'start', 'restart', 'stop', 'move'].includes(m.type)) return;
        receive(m);
      }, () => { connected = false; }); // Existing durable host outbox survives; no automatic launch retry.
      return {
        // Availability must be accepted before host() can announce online.
        ready: wire.ready.then(() => wire.publish(message('availability', retained.request.host, '', 0, { configuration: retained.request, observedAt: Date.now() }), retained.request.owner)).then(() => { connected = true; }).catch(error => { connected = false; wire.close(); throw error; }),
        close: () => { connected = false; wire.close(); },
        send(m: Message) {
          if (['prepare', 'prepared', 'grant'].includes(m.type)) {
            privateExchange({sender: retained.request.host, message: m}, retained.request.owner, m.host);
            void wire.publish(m, m.host).catch(() => {}); // Exact durable slot exchange/outbox owns retries.
            return;
          }
          if (m.host !== retained.request.host || !['availability', 'inventory', 'receipt'].includes(m.type)) throw Error('Invalid private host report');
          void wire.publish(m, retained.request.owner).catch(() => {}); // Host outbox/heartbeat retains retry state.
        },
      };
    },
  };
}
