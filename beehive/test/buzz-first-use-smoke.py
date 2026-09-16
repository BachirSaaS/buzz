"""Real Node controller + Bun renderer, synthetic credentials only; run from beehive.
BEEHIVE_SMOKE_NODE and BEEHIVE_BUN must point to Node 24.15.0 and packaged Bun.
No configured controller owner: only a normal Host and a synthetic Buzz key exist.
"""
import os, pty, select, time, struct, fcntl, termios, json, tempfile, subprocess
from pathlib import Path
root = os.getcwd()
home = tempfile.mkdtemp(prefix='beehive-pairing-cli-buzz-first-use-')
node = os.environ['BEEHIVE_SMOKE_NODE']
env = {'PATH': '/usr/bin:/bin', 'HOME': home, 'TERM': 'xterm-256color',
       'BEEHIVE_TEST_CREDENTIAL_FILE': home+'/credentials.json',
       'BEEHIVE_BUN': os.environ['BEEHIVE_BUN'],
       'NODE_OPTIONS': '--import='+root+'/test/manager-installed-loader.ts'}
seed = """import {bootstrapHostIdentity} from './src/host-identity.ts';
import {createCredential} from './src/credential-store.ts';
import {publicKey} from './src/protocol.ts';
import {isolatedFileCredentials} from './test/isolated-file-credentials.ts';
const key='1'.repeat(64), backend=isolatedFileCredentials(process.env.BEEHIVE_TEST_CREDENTIAL_FILE);
createCredential('owner',key,backend);
bootstrapHostIdentity(process.env.HOME+'/.beehive/host','Fixture Host',publicKey(key),'wss://fixture.invalid',backend);
console.log(publicKey(key));"""
owner = subprocess.check_output([node, '--input-type=module', '-e', seed], env=env, text=True).strip()
env['BEEHIVE_TEST_BUZZ_OWNER'] = owner
config = Path(home+'/.beehive/owner/controller.json')
assert not config.exists(), 'Regression must start with NO configured owner'
before = Path(env['BEEHIVE_TEST_CREDENTIAL_FILE']).read_bytes()
pid, fd = pty.fork()
if pid == 0:
    os.execve(node, [node, 'src/manager-entry.ts'], env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 140, 0, 0))
transcript = b''
frames = []
import re
ROWS, COLS = 36, 140
def screen(buf):
    cells={}; row=col=1; i=0; n=len(buf)
    while i<n:
        b=buf[i]
        if b==27 and i+1<n and buf[i+1]==91:
            j=i+2
            while j<n and not 64<=buf[j]<127: j+=1
            if j>=n: break
            params=buf[i+2:j].decode('latin1'); final=buf[j:j+1].decode('latin1')
            if final=='H':
                p=params.split(';')
                try: row=int(p[0]) if p[0] else 1; col=int(p[1]) if len(p)>1 and p[1] else 1
                except ValueError: pass
            elif final=='J' and params in ('','0','2'): cells={}
            elif final=='K':
                for c in range(col,COLS+1): cells.pop((row,c),None)
            i=j+1; continue
        if b==27 and i+1<n and buf[i+1] in (80,93,95,94):
            j=i+2
            while j<n:
                if buf[j]==7: j+=1; break
                if buf[j]==27 and j+1<n and buf[j+1]==92: j+=2; break
                j+=1
            i=j; continue
        if b==27: i+=1; continue
        if b==13: col=1; i+=1; continue
        if b==10: row=min(ROWS,row+1); i+=1; continue
        if b<32 or b==127: i+=1; continue
        L=1 if b<128 else 2 if b<224 else 3 if b<240 else 4
        try: ch=buf[i:i+L].decode('utf-8')
        except UnicodeDecodeError: i+=1; continue
        if row<=ROWS and col<=COLS: cells[(row,col)]=ch
        col+=1; i+=L
    rows={}
    for (r,c),ch in cells.items(): rows.setdefault(r,{})[c]=ch
    return [''.join(rows.get(r,{}).get(c,' ') for c in range(1,COLS+1)).rstrip() for r in range(1,ROWS+1)]

def wait(seconds=1):
    global transcript
    end = time.time()+seconds
    while time.time() < end:
        if select.select([fd], [], [], .05)[0]:
            try:
                transcript += os.read(fd, 65536)
                frames.append('\n'.join(screen(transcript)))
            except OSError:
                break

def send(data):
    os.write(fd, data)
    wait()

try:
    wait(2)
    send(b'\x1b[C')  # Agents
    send(b'a')       # Actions
    assert 'Sign in with Buzz key' in frames[-1]
    send(b'\x1b[B')  # Buzz action, not saved-key action
    send(b'\r')      # ONE selection; no more input
    wait(2)
    assert config.exists(), 'One selection did not initialize owner routing'
    assert json.loads(config.read_text()) == {'version': 1, 'owner': owner, 'relay': 'wss://fixture.invalid'}
    assert any('signed in' in frame.lower() for frame in frames), 'No signed-in UI state'
    for frame in frames:
        for forbidden in ['1 of 3', 'PUBLIC KEY', 'Owner public key', 'Type yes', 'Matching nsec', 'Matching private key']:
            assert forbidden not in frame, 'Unexpected modal: '+forbidden
    assert Path(env['BEEHIVE_TEST_CREDENTIAL_FILE']).read_bytes() == before, 'Credential copy/write'
    for file in Path(home+'/.beehive').rglob('*'):
        if file.is_file():
            assert b'1'*64 not in file.read_bytes(), 'Private key persisted'
            assert b'nsec1' not in file.read_bytes(), 'nsec persisted'
    assert b'1'*64 not in transcript and b'nsec1' not in transcript, 'Private key rendered'
    print('PASS first use: Agents -> Buzz key once -> derived owner signed in; no prompts or private copy. HOME='+home)
finally:
    Path(home+'/ui.ansi').write_bytes(transcript)
    Path(home+'/ui-frames.txt').write_text('\n--- FRAME ---\n'.join(frames))
    os.killpg(pid, 9)
    os.waitpid(pid, 0)
