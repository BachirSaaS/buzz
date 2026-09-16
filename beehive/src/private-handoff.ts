import { schnorr } from '@noble/curves/secp256k1';
import { digest, publicKey, type Message } from './protocol.ts';
import { hash, validateAssignment, type Assignment, type Grant } from './handoff.ts';
import type { AuthenticatedMessage } from './nostr-codec.ts';

const proofBytes = (grant: Grant, relay: string) => {
  const { proof: _proof, ...unsigned } = grant;
  return digest(JSON.stringify(['beehive-successor-v1', relay, unsigned]));
};
/** Sign before consuming authority and persisting the exact successor outbox. */
export function signSuccessor(grant: Grant, secret: string, relay: string): Grant {
  if (grant.source !== publicKey(secret) || grant.proof) throw Error('Wrong successor signer');
  return { ...grant, proof: Buffer.from(schnorr.sign(proofBytes(grant, relay), secret)).toString('hex') };
}
/** Trust only the locally pinned prefix; every unseen successor needs its source
 * signature. A public directory/availability claim can never extend authority. */
export function verifySuccessors(current: Assignment, next: Assignment, relay: string): void {
  validateAssignment(current); validateAssignment(next);
  const prefix = current.chain ?? [], chain = next.chain ?? [];
  if (hash(current.genesis) !== hash(next.genesis) || prefix.length > chain.length || !prefix.every((g, i) => hash(g) === hash(chain[i]))) throw Error('Conflicting pinned assignment');
  for (const g of chain.slice(prefix.length)) {
    if (!g.proof || !/^[0-9a-f]{128}$/.test(g.proof) || !/^[0-9a-f]{64}$/.test(g.source) || !schnorr.verify(g.proof, proofBytes(g, relay), g.source)) throw Error('Unsigned or invalid successor');
  }
}
/** Authenticate the immediate peer. The slot additionally verifies this claimed
 * chain against its retained prefix before preparation or grant acceptance. */
export function privateExchange(input: AuthenticatedMessage, owner: string, host: string): Message {
  const m = input.message;
  if (m.host !== host) throw Error('Wrong exchange recipient');
  let assignment: Assignment, sender: string;
  if (m.type === 'prepare') {
    assignment = m.body.assignment as Assignment;
    const op = m.body.operation as Message;
    sender = assignment.assignedHost;
    if (op.host !== sender || op.agent !== m.agent || op.type !== 'move' || op.body.target !== host || op.body.targetRevision !== m.revision) throw Error('Wrong preparation pair');
  } else if (m.type === 'prepared') {
    const prepare = m.body.prepare as Message;
    assignment = prepare.body.assignment as Assignment;
    const op = prepare.body.operation as Message;
    sender = prepare.host;
    if (prepare.type !== 'prepare' || prepare.agent !== m.agent || op.host !== host || op.body.target !== sender || op.agent !== m.agent || op.revision !== m.revision || assignment.assignedHost !== host) throw Error('Wrong prepared pair');
  } else if (m.type === 'grant') {
    assignment = m.body.assignment as Assignment;
    const grant = assignment.chain?.at(-1);
    if (!grant || grant.target !== host || grant.agent !== m.agent) throw Error('Wrong grant pair');
    sender = grant.source;
  } else throw Error('Not a peer exchange');
  validateAssignment(assignment);
  if (input.sender !== sender || sender === host || assignment.genesis.owner !== owner || assignment.genesis.agent !== m.agent) throw Error('Wrong exchange authority');
  return m;
}
