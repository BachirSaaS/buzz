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
direct = os.environ.get('BEEHIVE_SMOKE_DIRECT') == '1'
if direct:
    env.update(BEEHIVE_SMOKE_DIRECT='1', BEEHIVE_TEST_REGISTRATION_WALKTHROUGH='1', DATABRICKS_HOST='https://synthetic-workspace.example')
    seed = "import {publicKey} from './src/protocol.ts'; console.log(publicKey('1'.repeat(64)));"
owner = subprocess.check_output([node, '--input-type=module', '-e', seed], env=env, text=True).strip()
env['BEEHIVE_TEST_BUZZ_OWNER'] = owner
config = Path(home+'/.beehive/owner/controller.json')
assert not config.exists(), 'Regression must start with NO configured owner'
before = Path(env['BEEHIVE_TEST_CREDENTIAL_FILE']).read_bytes() if not direct else b''
def launch():
    pid, fd = pty.fork()
    if pid == 0:
        before_tty = termios.tcgetattr(0)
        command = [os.environ['BEEHIVE_SMOKE_LAUNCHER']] if os.environ.get('BEEHIVE_SMOKE_LAUNCHER') else [node, 'bin/beehive.cjs']
        result = subprocess.run(command, env=env)
        restored = termios.tcgetattr(0) == before_tty
        os.write(1, ('\nTERMINAL_RESTORED='+str(restored)+' EXIT='+str(result.returncode)+'\n').encode())
        os._exit(0 if restored and result.returncode == 0 else 1)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 100, 0, 0))
    return pid, fd
pid, fd = launch()
transcript = b''
frames = []
import re
ROWS, COLS = 30, 100
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

def enter_text(value):
    send(b'\x1b[200~'+value.encode()+b'\x1b[201~')
    send(b'\r')

def click_action(label):
    for y, line in enumerate(frames[-1].splitlines(),1):
        x = line.find(label, 29)
        if x >= 0:
            send(('\x1b[<0;%d;%dM\x1b[<0;%d;%dm' % (x+1,y,x+1,y)).encode())
            return
    raise AssertionError('Missing detail action '+label+'\n'+frames[-1])

def select_agent():
    for y, line in enumerate(frames[-1].splitlines(),1):
        x = line.find('Review agent')
        if 0 <= x < 28:
            send(('\x1b[<0;%d;%dM\x1b[<0;%d;%dm' % (x+1,y,x+1,y)).encode())
            return
    raise AssertionError('Missing agent row\n'+frames[-1])

def direct_journey():
    global pid, fd, transcript
    wait(3)
    send(b'\x1b[C')
    assert 'Sign in with Buzz key' in frames[-1]
    send(b'\x1b[C'); send(b'\r')  # contextual Buzz signin, resume Harnesses
    wait(2)
    assert config.exists()
    send(b'\x1b[C')
    assert 'Databricks' in frames[-1]
    click_action('Add provider')
    send(b'\r'); send(b'\r')  # OpenAI, default name
    enter_text('synthetic-provider-key'); enter_text('yes')
    send(b'\x1b[D'); click_action('Refresh harnesses')
    send(b'\x1b[D')
    assert 'Registered agents' in frames[-1] and 'Other agents' in frames[-1]
    # Select the known Other agent using the real list, then Start -> registration.
    select_agent()
    click_action('Start')
    enter_text('yes')
    assert 'Matching nsec' in frames[-1]
    nsec = subprocess.check_output([node,'--input-type=module','-e',"import {nsecEncode} from 'nostr-tools/nip19'; console.log(nsecEncode(Buffer.from('2'.repeat(64),'hex')));"],env=env,text=True).strip()
    enter_text(nsec)
    assert 'Harness' in frames[-1]
    send(b'\r') # Buzz Agent
    send(b'\x1b[B\r') # OpenAI, after environment Databricks
    send(b'\r') # gpt-5
    send(b'\x1b[B\x1b[B\x1b[B\r') # high effort
    send(b'\x15'); enter_text('{"REVIEW_MODE":"synthetic"}')
    enter_text('yes'); wait(5)
    assert 'running' in frames[-1], frames[-1]
    assert nsec.encode() not in transcript
    settings = json.loads(Path(home+'/.beehive/host/settings.json').read_text())
    assert len(settings['agents']) == 1 and len(settings['runtimes']) == 1
    assert settings['runtimes'][0]['environment'] == {'REVIEW_MODE':'synthetic'}
    click_action('Configure')
    # Reopened form defaults to the actual saved selection, not a named chooser.
    send(b'\r'); send(b'\r'); send(b'\r'); send(b'\r'); send(b'\r'); enter_text('yes'); wait(3)
    click_action('Stop'); enter_text('yes'); wait(3)
    assert 'stopped' in frames[-1]
    remembered = json.loads(Path(home+'/.beehive/host/settings.json').read_text())
    send(b'q'); wait(3)
    assert b'TERMINAL_RESTORED=True EXIT=0' in transcript
    os.waitpid(pid,0); os.close(fd)
    Path(home+'/first-ui.ansi').write_bytes(transcript)
    transcript = b''
    pid, fd = launch(); wait(3)
    # Actual launcher/controller reopen: retained provider, inventory, config and host journal.
    send(b'\x1b[C'); send(b'\r'); wait(2) # direct Buzz row
    select_agent()
    click_action('Start'); enter_text('yes'); wait(5)
    assert 'running' in frames[-1], frames[-1]
    reopened = json.loads(Path(home+'/.beehive/host/settings.json').read_text())
    for key in ['providers','runtimes','harnesses','agents']:
        assert reopened[key] == remembered[key], key
    click_action('Stop'); enter_text('yes'); wait(3)
    send(b'q'); wait(2)
    assert b'TERMINAL_RESTORED=True EXIT=0' in transcript
    print('PASS 100x30 direct lifecycle: contextual Buzz; env Databricks; provider Save; refresh; Other matching nsec; harness/provider/model/effort/environment; Configure; Start/Stop; actual launcher reopen; next Start; q restored. HOME='+home)

def first_use():
    wait(2)
    send(b'\x1b[C')  # Agents
    assert 'Sign in with Buzz key' in frames[-1]
    assert 'Sign in with saved' in frames[-1]
    send(b'\x1b[C')  # Protected Harnesses intent -> contextual chooser
    assert 'Buzz key' in frames[-1]
    send(b'\x1b')
    assert '[Agents]' in frames[-1] and 'Working' not in frames[-1]
    send(b'\x1b[C')
    send(b'\r')       # One Buzz selection resumes Harnesses
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
    assert '[Harnesses]' in frames[-1], 'Protected intent not resumed'
    send(b'q')
    wait(2)
    assert b'TERMINAL_RESTORED=True EXIT=0' in transcript
    print('PASS 100x30 actual launcher: signed-out Agents choices; contextual cancel/resume; Buzz once; q + terminal restored. HOME='+home)

try:
    direct_journey() if direct else first_use()
finally:
    Path(home+'/ui.ansi').write_bytes(transcript)
    Path(home+'/ui-frames.txt').write_text('\n--- FRAME ---\n'.join(frames))
    done, _ = os.waitpid(pid, os.WNOHANG)
    if not done:
        os.killpg(pid, 9)
        os.waitpid(pid, 0)
