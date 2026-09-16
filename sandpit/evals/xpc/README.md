# Daemon-mediated network-policy regressions

`reproduce-egress.py` demonstrates two network-policy violations from ordinary
`sandpit run` children. Both worked on macOS 26.6.2 arm64 against the PR #82 binary
from commit `173d7cd`, including its preference read/write denies.

The network profile now denies those daemon connections when a broker is active.
The same harness verifies that the fix blocks both PoCs and that launches with
no network rules can still use the services.

The policy allows only `no-destinations-allowed.invalid`. Each helper first tries
to connect directly to a loopback listener and receives EPERM. It then uses a
fresh connection to an allowed Apple service. The listener receives a unique
synthetic marker through the daemon. A control profile adds a Mach lookup deny
for that service and the marker no longer arrives.

| PoC | Request made by the sandboxed process | Observed policy violation |
| --- | --- | --- |
| `dnssd-egress.c` | Raw `getaddrinfo` XPC message to `com.apple.dnssd.service`, with a caller-selected fallback DNS-over-TLS resolver | The denied TCP listener receives a TLS ClientHello containing the synthetic marker in SNI. |
| `trustd-egress.c` | `SecTrustEvaluateWithError` on a generated leaf whose AIA issuer URL points at the listener | The denied HTTP listener receives `GET /<marker>.der`; after it returns the synthetic issuer, trust evaluation succeeds. |

Check the fix from the repository root after building Sandpit and its embedded dylib:

```sh
python3 evals/xpc/reproduce-egress.py --expect blocked
```

Each run creates a new directory under `target/`. To choose its location, add
`--output target/my-egress-proof`; that directory must not already exist. To run
one PoC, add `--only dnssd` or `--only trustd`. To test another build, add
`--sandpit /absolute/path/to/sandpit`.
Use `--expect bypass` with an affected binary to reproduce the original issue.
The script compiles the helpers using Command Line Tools and uses the installed
`/usr/bin/openssl` to generate the synthetic certificate chains.

The harness runs an unsandboxed baseline, a Sandpit launch without network rules,
a network-restricted Sandpit launch through `/usr/bin/env`, and an explicit-deny
control for each PoC. The helper confirms that Sandpit's
configuration is present and its DYLD library is absent. It captures the actual
generated Seatbelt profile. The control uses that captured profile with the
additional service deny, and its listener port is checked against the profile's
existing port exceptions.

The PoCs establish connections after Sandpit applies the sandbox. The listeners
are ordinary TCP/HTTP servers in the parent test harness, using non-inherited
sockets. No custom Mach service, pre-opened XPC connection, or transferred
endpoint is supplied to the child.

For DNS, the marker appears in a TLS ClientHello. The test does not complete a TLS
handshake or claim arbitrary application-data transfer. The incoming TCP
connection and transmitted marker are enough to demonstrate the violated network
policy. The request is explicitly stopped after the observation window.

For trust evaluation, each case generates a fresh root, intermediate, and leaf to
avoid a cached issuer hiding the network fetch. The child receives only the leaf
and root certificates; the intermediate is served over HTTP. The root is an
anchor for this one evaluation. No certificate is added to a system trust store
or Keychain. Synthetic signing keys are deleted after generation.

The control rules that stopped the tested paths are:

```scheme
;; DNS-over-TLS delegation.
(deny mach-lookup (global-name "com.apple.dnssd.service"))

;; Certificate issuer fetching.
(deny mach-lookup
  (global-name "com.apple.trustd.agent")
  (global-name "com.apple.trustd"))
```

The production network profile denies both trustd names and both DNS service
names (`com.apple.dnssd.service` and `com.apple.mDNSResponder`). The PoCs use only
loopback listeners and synthetic markers; their measured scope is a network-policy
bypass on the affected build. Ordinary HTTPS through the broker was also checked
with system curl, Python, and Node on the fixed build.

`report.json` records the executable SHA-256, checkout commit, platform, command
output, generated-profile hashes, direct-connect errors, received TLS SNI/HTTP
paths, and control outcomes. The runner exits unsuccessfully unless the baselines
work, the restricted launch matches `--expect`, and the explicit-deny control
stops the bypass. The `confirmed` fields mean that the chosen expectation and
all controls passed; `bypass_observed` records whether the bypass worked. Servers
are closed after each case; logs, compiled helpers, profiles, and public test
certificates remain for inspection.

The raw DNS message fields are grounded in Apple's
[dnssd_xpc.c](https://github.com/apple-oss-distributions/mDNSResponder/blob/mDNSResponder-2200.60.25.0.4/mDNSMacOSX/dnssd_xpc.c)
and [dnssd_server.c](https://github.com/apple-oss-distributions/mDNSResponder/blob/mDNSResponder-2200.60.25.0.4/mDNSMacOSX/dnssd_server.c).
The fallback dictionary matches the installed Network framework's serialized
resolver configuration. The trust path is implemented in Apple's
[SecCAIssuerRequest.m](https://github.com/apple-oss-distributions/Security/blob/main/trust/trustd/SecCAIssuerRequest.m).
