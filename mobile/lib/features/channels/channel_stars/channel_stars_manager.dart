import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:nostr/nostr.dart' as nostr;
import 'package:shared_preferences/shared_preferences.dart';

import '../../../shared/crypto/nip44.dart';
import '../../../shared/relay/relay.dart';
import '../../../shared/read_state/read_state_time.dart';
import 'channel_stars_storage.dart';

class ChannelStarsCrypto {
  final Uint8List _conversationKey;

  ChannelStarsCrypto(String nsec, String pubkey)
    : _conversationKey = _deriveKey(nsec, pubkey);

  static Uint8List _deriveKey(String nsec, String pubkey) {
    final privkeyHex = nostr.Nip19.decode(payload: nsec).data;
    return getConversationKey(privkeyHex, pubkey);
  }

  String encrypt(String plaintext) => nip44Encrypt(_conversationKey, plaintext);

  String decrypt(String ciphertext) =>
      nip44Decrypt(_conversationKey, ciphertext);
}

class ChannelStarsManager {
  final String pubkey;
  final ChannelStarsStorage _storage;
  final ChannelStarsCrypto _crypto;
  final RelaySessionNotifier? _relaySession;
  final SignedEventRelay? _signedEventRelay;
  final bool _remoteEnabled;
  final VoidCallback _onChanged;

  ChannelStarStore _store;
  ChannelStarStore? _lastPublishedStore;
  Timer? _publishDebounce;
  int _lastRemoteCreatedAt = 0;
  String? _lastRemoteEventId;
  void Function()? _unsubscribe;
  bool _disposed = false;

  /// Base delay for the startup-sync retry backoff. Overridable in tests.
  final Duration _startupRetryBaseDelay;
  Timer? _startupRetryTimer;
  int _startupRetryAttempt = 0;
  bool _startupFetchSucceeded = false;
  int _subscriptionGeneration = 0;

  ChannelStarsManager({
    required this.pubkey,
    required SharedPreferences prefs,
    required ChannelStarsCrypto crypto,
    required RelaySessionNotifier? relaySession,
    required SignedEventRelay? signedEventRelay,
    required bool remoteEnabled,
    required VoidCallback onChanged,
    @visibleForTesting
    Duration startupRetryBaseDelay = const Duration(seconds: 2),
  }) : _storage = ChannelStarsStorage(prefs),
       _crypto = crypto,
       _relaySession = relaySession,
       _signedEventRelay = signedEventRelay,
       _remoteEnabled = remoteEnabled,
       _onChanged = onChanged,
       _startupRetryBaseDelay = startupRetryBaseDelay,
       _store = ChannelStarsStorage(prefs).read(pubkey);

  ChannelStarStore get store => _store;

  Future<void> initialize() async {
    if (_disposed) return;

    if (!_remoteEnabled || _relaySession == null) {
      _onChanged();
      return;
    }

    await _syncWithRelay();
    _onChanged();
  }

  /// One startup-sync attempt: fetch the remote blob, then start the live
  /// subscription. Either step can fail transiently — retry with bounded
  /// backoff (2s base, 30s ceiling) until both succeed.
  Future<void> _syncWithRelay() async {
    if (_disposed) return;

    if (!_startupFetchSucceeded) {
      final fetched = await _fetchAndMerge();
      if (_disposed) return;
      _startupFetchSucceeded = fetched;
    }

    final subscribed = _unsubscribe != null || await _startLiveSubscription();
    if (_disposed) return;

    if (!_startupFetchSucceeded || !subscribed) {
      _scheduleStartupRetry();
    } else {
      _startupRetryAttempt = 0;
    }
  }

  void _scheduleStartupRetry() {
    if (_disposed) return;
    _startupRetryTimer?.cancel();
    final delayMs = min(
      _startupRetryBaseDelay.inMilliseconds << min(_startupRetryAttempt, 5),
      30000,
    );
    _startupRetryAttempt++;
    debugPrint(
      '[ChannelStarsManager] startup sync incomplete; '
      'retrying in ${delayMs}ms (attempt $_startupRetryAttempt)',
    );
    _startupRetryTimer = Timer(Duration(milliseconds: delayMs), () {
      _startupRetryTimer = null;
      unawaited(
        _syncWithRelay().then((_) {
          if (!_disposed) _onChanged();
        }),
      );
    });
  }

  void dispose({bool flushPending = true}) {
    if (_disposed) return;
    _disposed = true;
    _subscriptionGeneration++;

    _startupRetryTimer?.cancel();
    _startupRetryTimer = null;

    final hadPending = _publishDebounce != null;
    _publishDebounce?.cancel();
    _publishDebounce = null;

    if (flushPending && hadPending && _remoteEnabled) {
      unawaited(_publish(allowDisposed: true));
    }

    _unsubscribe?.call();
    _unsubscribe = null;
  }

  void starChannel(String channelId) {
    if (_disposed) return;
    final entry = ChannelStarEntry(
      starred: true,
      updatedAt: currentUnixSeconds(),
    );
    _store = ChannelStarStore(channels: {..._store.channels, channelId: entry});
    _persist();
    _onChanged();
    markDirty();
  }

  void unstarChannel(String channelId) {
    if (_disposed) return;
    final entry = ChannelStarEntry(
      starred: false,
      updatedAt: currentUnixSeconds(),
    );
    _store = ChannelStarStore(channels: {..._store.channels, channelId: entry});
    _persist();
    _onChanged();
    markDirty();
  }

  void markDirty() {
    if (!_remoteEnabled || _disposed) return;
    _publishDebounce?.cancel();
    _publishDebounce = Timer(const Duration(seconds: 5), () {
      _publishDebounce = null;
      unawaited(_publish());
    });
  }

  /// Returns true when the fetch reached the relay (regardless of whether a
  /// remote blob exists).
  Future<bool> _fetchAndMerge({bool allowDisposed = false}) async {
    if (_relaySession == null) return false;
    try {
      final events = await _relaySession.fetchHistory(
        NostrFilter(
          kinds: const [EventKind.readState],
          authors: [pubkey],
          tags: const {
            '#d': ['channel-stars'],
          },
          limit: 1,
        ),
      );
      if (_disposed && !allowDisposed) return false;
      _mergeEvents(events);
      _persist();
      if (!_disposed) _onChanged();
      return true;
    } catch (error) {
      debugPrint('[ChannelStarsManager] fetch failed: $error');
      // Local state remains usable when relay is unavailable.
      return false;
    }
  }

  /// Returns true when the live subscription was established.
  Future<bool> _startLiveSubscription() async {
    if (_relaySession == null || _disposed) return false;
    final generation = ++_subscriptionGeneration;
    try {
      final unsubscribe = await _relaySession.subscribe(
        NostrFilter(
          kinds: const [EventKind.readState],
          authors: [pubkey],
          tags: const {
            '#d': ['channel-stars'],
          },
          limit: 1,
        ),
        _handleIncomingEvent,
        onClosed: (message) => _handleSubscriptionClosed(generation, message),
      );
      if (_disposed || generation != _subscriptionGeneration) {
        unsubscribe();
        return false;
      }
      _unsubscribe = unsubscribe;
      return true;
    } catch (error) {
      debugPrint('[ChannelStarsManager] live subscription failed: $error');
      return false;
    }
  }

  /// A relay `CLOSED` can arrive after `subscribe()` already reported success.
  /// Without this handler the manager would keep a dead subscription and never
  /// retry — the exact load-correlated cold-start failure this retry exists for.
  void _handleSubscriptionClosed(int generation, String message) {
    if (_disposed || generation != _subscriptionGeneration) return;
    debugPrint(
      '[ChannelStarsManager] live subscription closed by relay: $message',
    );
    _unsubscribe = null;
    _subscriptionGeneration++;
    _scheduleStartupRetry();
  }

  void _mergeEvents(List<NostrEvent> events) {
    for (final event in events) {
      if (event.pubkey != pubkey) continue;
      _mergeEvent(event);
    }
  }

  void _mergeEvent(NostrEvent event) {
    // Only process channel-stars d-tag events.
    final dTag = event.getTagValue('d');
    if (dTag != 'channel-stars') return;

    try {
      final plaintext = _crypto.decrypt(event.content);
      final parsed = jsonDecode(plaintext);
      if (parsed is! Map<String, dynamic>) return;

      final incoming = ChannelStarStore.fromJson(parsed);

      // Last-write-wins: newer createdAt wins; tie-break by event ID.
      // Relay retains `ORDER BY created_at DESC, id ASC`, so the lower ID wins
      // at equal second — accept incoming only if its ID is lexicographically
      // lower than the one we already hold.
      final isNewer =
          event.createdAt > _lastRemoteCreatedAt ||
          (event.createdAt == _lastRemoteCreatedAt &&
              event.id.compareTo(_lastRemoteEventId ?? '') < 0);

      if (isNewer) {
        _lastRemoteCreatedAt = event.createdAt;
        _lastRemoteEventId = event.id;
        // Per-channel merge: keep the entry with the highest updatedAt for each channel.
        _store = mergeStores(_store, incoming);
        _persist();
      }
    } catch (_) {
      // Decryption failure or parse error — keep existing state.
    }
  }

  void _handleIncomingEvent(NostrEvent event) {
    if (_disposed) return;
    _mergeEvent(event);
    if (!_disposed) _onChanged();
  }

  bool _isIdenticalToLastPublished() {
    final last = _lastPublishedStore;
    if (last == null) return false;
    if (last.channels.length != _store.channels.length) return false;
    for (final key in _store.channels.keys) {
      final lastEntry = last.channels[key];
      final currentEntry = _store.channels[key];
      if (lastEntry == null ||
          lastEntry.starred != currentEntry!.starred ||
          lastEntry.updatedAt != currentEntry.updatedAt) {
        return false;
      }
    }
    return true;
  }

  Future<void> _publish({bool allowDisposed = false}) async {
    if ((!allowDisposed && _disposed) ||
        !_remoteEnabled ||
        _signedEventRelay == null) {
      return;
    }

    // Read-before-write: merge remote state before publishing
    await _fetchAndMerge(allowDisposed: allowDisposed);

    // No-op suppression: skip if nothing changed
    if (_isIdenticalToLastPublished()) return;

    try {
      final payload = jsonEncode(_store.toJson());
      final ciphertext = _crypto.encrypt(payload);
      final createdAt = max(currentUnixSeconds(), _lastRemoteCreatedAt + 1);

      await _signedEventRelay.submit(
        kind: EventKind.readState,
        content: ciphertext,
        tags: [
          ['d', 'channel-stars'],
          ['t', 'channel-stars'],
        ],
        createdAt: createdAt,
      );

      _lastRemoteCreatedAt = max(_lastRemoteCreatedAt, createdAt);
      _lastPublishedStore = ChannelStarStore(channels: Map.of(_store.channels));
    } catch (error) {
      debugPrint('[ChannelStarsManager] publish failed: $error');
    }
  }

  void _persist() {
    _storage.write(pubkey, _store);
  }
}
