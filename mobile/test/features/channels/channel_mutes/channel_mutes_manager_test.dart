import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:nostr/nostr.dart' as nostr;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:buzz/features/channels/channel_mutes/channel_mutes_manager.dart';
import 'package:buzz/shared/relay/relay.dart';

void main() {
  late SharedPreferences prefs;
  late nostr.Keys keychain;
  late ChannelMutesCrypto crypto;

  Future<void> setUpEnv() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    keychain = nostr.Keys.generate();
    crypto = ChannelMutesCrypto(keychain.nsec, keychain.public);
  }

  NostrEvent mutesEvent({
    required Map<String, Map<String, dynamic>> channels,
    required int createdAt,
    String id = 'remote-event',
  }) {
    final payload = jsonEncode({'version': 1, 'channels': channels});
    return NostrEvent(
      id: id,
      pubkey: keychain.public,
      createdAt: createdAt,
      kind: EventKind.readState,
      tags: const [
        ['d', 'channel-mutes'],
        ['t', 'channel-mutes'],
      ],
      content: crypto.encrypt(payload),
      sig: 'sig',
    );
  }

  ChannelMutesManager buildManager({
    required RelaySessionNotifier relaySession,
    Duration startupRetryBaseDelay = const Duration(milliseconds: 5),
  }) {
    return ChannelMutesManager(
      pubkey: keychain.public,
      prefs: prefs,
      crypto: crypto,
      relaySession: relaySession,
      signedEventRelay: null,
      remoteEnabled: true,
      onChanged: () {},
      startupRetryBaseDelay: startupRetryBaseDelay,
    );
  }

  test('stale_at_open_converges_after_fetch_retry', () async {
    // A transient fetch failure on cold start must not silently strand the
    // manager. The retry backoff must eventually land the remote blob.
    await setUpEnv();
    final relay = _RateLimitedRelaySession(
      failuresBeforeSuccess: 2,
      historyEvents: [
        mutesEvent(
          channels: {
            'ch1': {'muted': true, 'updatedAt': 100},
          },
          createdAt: 100,
        ),
      ],
    );

    final manager = buildManager(
      relaySession: relay,
      startupRetryBaseDelay: const Duration(milliseconds: 10),
    );
    await manager.initialize();

    expect(
      manager.store.channels,
      isEmpty,
      reason: 'first fetch lost the rate-limit race',
    );

    await _waitUntil(() => manager.store.channels.containsKey('ch1'));

    expect(manager.store.channels['ch1']!.muted, isTrue);
    expect(relay.subscribeCalls, greaterThan(1));
    manager.dispose(flushPending: false);
  });

  test('tie_break_lower_id_wins_at_equal_second', () async {
    // Relay retains `ORDER BY created_at DESC, id ASC` — the lower event ID
    // wins at equal second. The manager must converge to the same event.
    await setUpEnv();
    final lowerIdEvent = mutesEvent(
      channels: {
        'ch1': {'muted': true, 'updatedAt': 100},
      },
      createdAt: 100,
      id: 'aaaa',
    );
    final higherIdEvent = mutesEvent(
      channels: {
        'ch2': {'muted': true, 'updatedAt': 100},
      },
      createdAt: 100,
      id: 'zzzz',
    );

    final relay = _StaticRelaySession(events: [higherIdEvent]);
    final manager = buildManager(relaySession: relay);
    await manager.initialize();
    await _waitUntil(() => manager.store.channels.containsKey('ch2'));

    // Deliver the lower-ID event via the live subscription — it should win.
    relay.emit(lowerIdEvent);
    await Future<void>.delayed(const Duration(milliseconds: 30));

    expect(
      manager.store.channels.containsKey('ch1'),
      isTrue,
      reason: 'lower-ID event must win at equal second',
    );
    manager.dispose(flushPending: false);
  });
}

Future<void> _waitUntil(
  bool Function() condition, {
  Duration timeout = const Duration(seconds: 2),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) {
      fail('condition not met within $timeout');
    }
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

class _StaticRelaySession extends RelaySessionNotifier {
  _StaticRelaySession({required this.events});

  final List<NostrEvent> events;
  final List<void Function(NostrEvent)> _listeners = [];
  final List<void Function(String)> _closedCallbacks = [];

  void emit(NostrEvent event) {
    for (final l in List.of(_listeners)) {
      l(event);
    }
  }

  @override
  Future<List<NostrEvent>> fetchHistory(
    NostrFilter filter, {
    Duration timeout = const Duration(seconds: 8),
  }) async => events;

  @override
  Future<void Function()> subscribe(
    NostrFilter filter,
    void Function(NostrEvent) onEvent, {
    void Function(String message)? onClosed,
  }) async {
    _listeners.add(onEvent);
    _closedCallbacks.add(onClosed ?? (_) {});
    return () {
      final idx = _listeners.indexOf(onEvent);
      if (idx >= 0) {
        _listeners.removeAt(idx);
        _closedCallbacks.removeAt(idx);
      }
    };
  }
}

class _RateLimitedRelaySession extends RelaySessionNotifier {
  _RateLimitedRelaySession({
    required this.failuresBeforeSuccess,
    this.historyEvents = const [],
  });

  final int failuresBeforeSuccess;
  final List<NostrEvent> historyEvents;
  int fetchCalls = 0;
  int subscribeCalls = 0;
  final List<void Function(NostrEvent)> _listeners = [];
  final List<void Function(String)> _closedCallbacks = [];

  @override
  Future<List<NostrEvent>> fetchHistory(
    NostrFilter filter, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    fetchCalls++;
    if (fetchCalls <= failuresBeforeSuccess) {
      throw Exception('rate-limited: quota exceeded; retry in 2s');
    }
    return historyEvents;
  }

  @override
  Future<void Function()> subscribe(
    NostrFilter filter,
    void Function(NostrEvent) onEvent, {
    void Function(String message)? onClosed,
  }) async {
    subscribeCalls++;
    if (subscribeCalls <= failuresBeforeSuccess) {
      throw Exception('rate-limited: quota exceeded; retry in 1s');
    }
    _listeners.add(onEvent);
    _closedCallbacks.add(onClosed ?? (_) {});
    return () {
      final idx = _listeners.indexOf(onEvent);
      if (idx >= 0) {
        _listeners.removeAt(idx);
        _closedCallbacks.removeAt(idx);
      }
    };
  }
}
