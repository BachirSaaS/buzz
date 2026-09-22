import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:nostr/nostr.dart' as nostr;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:buzz/features/channels/channel_stars/channel_stars_manager.dart';
import 'package:buzz/shared/relay/relay.dart';

void main() {
  late SharedPreferences prefs;
  late nostr.Keys keychain;
  late ChannelStarsCrypto crypto;

  Future<void> setUpEnv() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    keychain = nostr.Keys.generate();
    crypto = ChannelStarsCrypto(keychain.nsec, keychain.public);
  }

  NostrEvent starsEvent({
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
        ['d', 'channel-stars'],
        ['t', 'channel-stars'],
      ],
      content: crypto.encrypt(payload),
      sig: 'sig',
    );
  }

  ChannelStarsManager buildManager({
    required RelaySessionNotifier relaySession,
    Duration startupRetryBaseDelay = const Duration(milliseconds: 5),
  }) {
    return ChannelStarsManager(
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

  test('stale-at-open converges after fetch retry', () async {
    // A transient fetch failure on cold start must not silently strand the
    // manager. The retry backoff must eventually land the remote blob.
    await setUpEnv();
    final relay = _RateLimitedRelaySession(
      failuresBeforeSuccess: 2,
      historyEvents: [
        starsEvent(
          channels: {
            'ch1': {'starred': true, 'updatedAt': 100},
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

    expect(manager.store.channels['ch1']!.starred, isTrue);
    expect(relay.subscribeCalls, greaterThan(1));
    manager.dispose(flushPending: false);
  });

  test('subscription CLOSED triggers retry and re-sync', () async {
    // A relay CLOSED arriving after subscribe() resolved must not leave the
    // manager silently dead. It must re-enter the retry loop.
    await setUpEnv();
    final relay = _RateLimitedRelaySession(
      failuresBeforeSuccess: 0,
      historyEvents: [
        starsEvent(
          channels: {
            'ch1': {'starred': true, 'updatedAt': 100},
          },
          createdAt: 100,
        ),
      ],
    );

    final manager = buildManager(relaySession: relay);
    await manager.initialize();
    await _waitUntil(() => manager.store.channels.containsKey('ch1'));

    final subscribeCallsBefore = relay.subscribeCalls;
    relay.closeLiveSubscription('rate-limited: quota exceeded');

    await _waitUntil(() => relay.subscribeCalls > subscribeCallsBefore);

    expect(
      relay.subscribeCalls,
      greaterThan(subscribeCallsBefore),
      reason: 'CLOSED handler must schedule a retry subscribe',
    );
    manager.dispose(flushPending: false);
  });

  test('tie_break_lower_id_wins_at_equal_second', () async {
    // Relay retains `ORDER BY created_at DESC, id ASC` — the lower event ID
    // wins at equal second. The manager must converge to the same event.
    await setUpEnv();
    final lowerIdEvent = starsEvent(
      channels: {
        'ch1': {'starred': true, 'updatedAt': 100},
      },
      createdAt: 100,
      id: 'aaaa',
    );
    final higherIdEvent = starsEvent(
      channels: {
        'ch2': {'starred': true, 'updatedAt': 100},
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
    expect(
      manager.store.channels.containsKey('ch2'),
      isTrue,
      reason: 'per-channel merge preserves both entries',
    );
    manager.dispose(flushPending: false);
  });

  test('tie_break_higher_id_ignored_at_equal_second', () async {
    // After adopting the lower-ID event, a higher-ID same-second re-delivery
    // must NOT replace it (relay would not retain the higher one).
    await setUpEnv();
    final lowerIdEvent = starsEvent(
      channels: {
        'ch1': {'starred': true, 'updatedAt': 100},
      },
      createdAt: 100,
      id: 'aaaa',
    );
    final higherIdEvent = starsEvent(
      channels: {
        'ch2': {'starred': false, 'updatedAt': 100},
      },
      createdAt: 100,
      id: 'zzzz',
    );

    final relay = _StaticRelaySession(events: [lowerIdEvent]);
    final manager = buildManager(relaySession: relay);
    await manager.initialize();
    await _waitUntil(() => manager.store.channels.containsKey('ch1'));

    // The lower-ID event is now the baseline. A higher-ID same-second event
    // must be rejected (isNewer = false).
    relay.emit(higherIdEvent);
    await Future<void>.delayed(const Duration(milliseconds: 30));

    // ch2 from higherIdEvent must NOT be adopted into the store; the
    // higher-ID event is rejected by the tie-break guard before mergeStores.
    expect(
      manager.store.channels.containsKey('ch2'),
      isFalse,
      reason: 'higher-ID event at equal second must be rejected',
    );
    manager.dispose(flushPending: false);
  });

  test('pending_edit_survives_retry_tick', () async {
    // A retry-driven merge must not cancel the pending debounce or clobber
    // the local star. The per-channel max-updatedAt merge in mergeStores
    // preserves a locally-stamped entry against an older remote entry.
    await setUpEnv();
    final remoteEvent = starsEvent(
      channels: {
        'ch-remote': {'starred': true, 'updatedAt': 1},
      },
      createdAt: 50,
    );
    final relay = _RateLimitedRelaySession(
      failuresBeforeSuccess: 1,
      historyEvents: [remoteEvent],
    );

    final manager = buildManager(
      relaySession: relay,
      startupRetryBaseDelay: const Duration(milliseconds: 10),
    );
    await manager.initialize();

    // Local edit before retry lands.
    manager.starChannel('ch-local');
    expect(manager.store.channels.containsKey('ch-local'), isTrue);

    // Wait for retry to succeed and merge.
    await _waitUntil(() => manager.store.channels.containsKey('ch-remote'));

    // Local star must survive through the merge.
    expect(
      manager.store.channels.containsKey('ch-local'),
      isTrue,
      reason: 'local star must survive a retry-driven remote merge',
    );
    expect(manager.store.channels['ch-local']!.starred, isTrue);
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
  int subscribeCalls = 0;

  void emit(NostrEvent event) {
    for (final l in List.of(_listeners)) {
      l(event);
    }
  }

  void closeLiveSubscription(String message) {
    if (_listeners.isEmpty) return;
    _listeners.removeAt(0);
    final onClosed = _closedCallbacks.removeAt(0);
    onClosed(message);
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
    subscribeCalls++;
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

/// Rejects the first [failuresBeforeSuccess] fetch and subscribe calls,
/// then succeeds — mirrors the sections manager test helper.
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

  void emit(NostrEvent event) {
    for (final l in List.of(_listeners)) {
      l(event);
    }
  }

  void closeLiveSubscription(String message) {
    if (_listeners.isEmpty) return;
    _listeners.removeAt(0);
    final onClosed = _closedCallbacks.removeAt(0);
    onClosed(message);
  }

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
