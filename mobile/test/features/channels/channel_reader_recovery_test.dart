import 'dart:async';

import 'package:buzz/features/channels/channel_mutes/channel_mutes_manager.dart';
import 'package:buzz/features/channels/channel_sections/channel_sections_manager.dart';
import 'package:buzz/features/channels/channel_sort/channel_sort_manager.dart';
import 'package:buzz/features/channels/channel_sort/channel_sort_storage.dart';
import 'package:buzz/features/channels/channel_stars/channel_stars_manager.dart';
import 'package:fake_async/fake_async.dart';
import 'package:buzz/shared/relay/relay.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'sidebar_sync_fixture.dart';

/// The per-entry lanes share one manager shape; each case runs on both.
class _Lane {
  const _Lane(this.dTag, this.field, this.build);

  final String dTag;
  final String field;
  final _Subject Function(SharedPreferences prefs, SidebarRelay relay) build;
}

class _Subject {
  _Subject({
    required this.init,
    required this.values,
    required this.set,
    required this.refresh,
    required this.dispose,
  });

  final Future<void> Function() init;
  final Map<String, bool> Function() values;
  final void Function(String channel, bool value) set;
  final void Function() refresh;
  final void Function() dispose;
}

final _lanes = [
  _Lane('channel-stars', 'starred', (prefs, relay) {
    final m = ChannelStarsManager(
      pubkey: relay.pubkey,
      prefs: prefs,
      crypto: ChannelStarsCrypto(relay.keys.nsec, relay.pubkey),
      relaySession: relay.session,
      signedEventRelay: relay.signer,
      remoteEnabled: true,
      onChanged: () {},
    );
    return _Subject(
      init: m.initialize,
      values: () => {
        for (final e in m.store.channels.entries) e.key: e.value.starred,
      },
      set: (c, v) => v ? m.starChannel(c) : m.unstarChannel(c),
      refresh: m.refreshFromRelay,
      dispose: () => m.dispose(flushPending: false),
    );
  }),
  _Lane('channel-mutes', 'muted', (prefs, relay) {
    final m = ChannelMutesManager(
      pubkey: relay.pubkey,
      prefs: prefs,
      crypto: ChannelMutesCrypto(relay.keys.nsec, relay.pubkey),
      relaySession: relay.session,
      signedEventRelay: relay.signer,
      remoteEnabled: true,
      onChanged: () {},
    );
    return _Subject(
      init: m.initialize,
      values: () => {
        for (final e in m.store.channels.entries) e.key: e.value.muted,
      },
      set: (c, v) => v ? m.muteChannel(c) : m.unmuteChannel(c),
      refresh: m.refreshFromRelay,
      dispose: () => m.dispose(flushPending: false),
    );
  }),
];

void main() {
  late SharedPreferences prefs;
  setUp(() async => prefs = await freshPrefs());
  wholeBlobLanes(() => prefs);

  for (final lane in _lanes) {
    Map<String, Object> blob(Map<String, (bool, int)> entries) => {
      'version': 1,
      'channels': {
        for (final e in entries.entries)
          e.key: {lane.field: e.value.$1, 'updatedAt': e.value.$2},
      },
    };

    group(lane.dTag, () {
      late SidebarRelay relay;
      late _Subject subject;
      late int t;
      setUp(() {
        relay = SidebarRelay();
        t = nowSeconds();
      });
      tearDown(() => subject.dispose());

      _Subject start(FakeAsync clock, {SharedPreferences? store}) {
        subject = lane.build(store ?? prefs, relay);
        subject.init();
        clock.flushMicrotasks();
        return subject;
      }

      for (final priorHead in [false, true]) {
        fakeAsyncTest('OK before echo keeps a coherent cursor '
            '(${priorHead ? 'stale prior id' : 'no prior id'})', (clock) {
          const low =
              '0000000000000000000000000000000000000000000000000000000000000000';
          if (priorHead) {
            relay.stored.add(relay.event(lane.dTag, blob({}), t + 30, id: low));
          }
          start(clock).set('mine', true);
          clock.elapse(const Duration(seconds: 5));
          final own = relay.published.single;
          expect(own.createdAt, priorHead ? t + 31 : t);

          // The OK beat the (never delivered) echo. A same-second peer that
          // the relay retains over our event must still be adopted.
          final peerId = '${low.substring(1)}1';
          expect(peerId.compareTo(own.id), lessThan(0));
          relay.emit(
            relay.event(
              lane.dTag,
              blob({'peer': (true, own.createdAt)}),
              own.createdAt,
              id: peerId,
            ),
          );
          clock.elapse(const Duration(milliseconds: 20));
          expect(subject.values(), {'mine': true, 'peer': true});
        });
      }

      for (final afterFallback in [false, true]) {
        fakeAsyncTest(
          'terminal CLOSED ${afterFallback ? 'after' : 'before'} the readiness '
          'fallback is not re-sent; history still recovers',
          (clock) {
            relay
              ..historyFailures = 1
              ..stored.add(relay.event(lane.dTag, blob({'a': (true, t)}), t));
            if (afterFallback) {
              relay.withholdEose = true;
            } else {
              relay.rejectLive = 'restricted: not allowed';
            }
            start(clock);
            clock.elapse(const Duration(milliseconds: 600));
            if (afterFallback) {
              relay.closeLive(lane.dTag, 'error: too many subscriptions');
            }
            clock.elapse(const Duration(minutes: 5));
            expect(relay.reqsFor(lane.dTag, 'l-'), hasLength(1));
            expect(relay.reqsFor(lane.dTag, 'h-'), hasLength(2));
            expect(subject.values(), {'a': true});
          },
        );
      }

      for (final error in [null, StateError('disk full')]) {
        fakeAsyncTest(
          'failed persist (${error == null ? 'false' : 'throws'}) retries the '
          'same head until it is durable',
          (clock) {
            final flaky = FlakyPrefs(prefs)
              ..failures = 1
              ..error = error;
            relay.stored.add(relay.event(lane.dTag, blob({'a': (true, t)}), t));
            start(clock, store: flaky);
            expect(prefs.getKeys(), isEmpty);
            clock.elapse(const Duration(seconds: 2));
            expect(relay.reqsFor(lane.dTag, 'h-'), hasLength(2));
            expect(prefs.getKeys(), hasLength(1));
            expect(subject.values(), {'a': true});
          },
        );
      }

      fakeAsyncTest(
        'a read held across a local edit defers instead of overwriting it',
        (clock) {
          start(clock);
          // The peer's clock runs one second ahead of ours on the same channel.
          relay.stored.add(
            relay.event(lane.dTag, blob({'c': (false, t + 1)}), t + 1),
          );
          final held = relay.holdHistory = Completer<void>();
          subject.refresh();
          clock.flushMicrotasks();
          subject.set('c', true);
          held.complete();
          relay.holdHistory = null;
          clock.flushMicrotasks();
          expect(subject.values(), {'c': true});

          // Resume while the edit is still pending leaves it alone too.
          subject.refresh();
          clock.flushMicrotasks();
          expect(subject.values(), {'c': true});
          expect(relay.reqsFor(lane.dTag, 'h-'), hasLength(2));
        },
      );
    });
  }
}

/// Whole-blob lanes: resume re-read, and sections' publication cursor.
void wholeBlobLanes(SharedPreferences Function() prefs) {
  group('sections', () {
    late SidebarRelay relay;
    late ChannelSectionsManager m;
    setUp(() => relay = SidebarRelay());
    tearDown(() => m.dispose(flushPending: false));

    Map<String, Object> blob(String name) => {
      'version': 1,
      'sections': [
        {'id': name, 'name': name, 'order': 0},
      ],
      'assignments': <String, String>{},
    };

    ChannelSectionsManager start(FakeAsync clock) {
      m = ChannelSectionsManager(
        pubkey: relay.pubkey,
        prefs: prefs(),
        crypto: ChannelSectionsCrypto(relay.keys.nsec, relay.pubkey),
        relaySession: relay.session,
        signedEventRelay: relay.signer,
        remoteEnabled: true,
        onChanged: () {},
      )..initialize();
      clock.flushMicrotasks();
      return m;
    }

    List<String> names() => [for (final s in m.store.sections) s.name];

    fakeAsyncTest('resume adopts a head the healthy socket missed', (clock) {
      final t = nowSeconds();
      start(clock);
      relay.stored.add(relay.event('channel-sections', blob('later'), t));
      m.refreshFromRelay();
      clock.flushMicrotasks();
      expect(names(), ['later']);
      expect(relay.reqsFor('channel-sections', 'l-'), hasLength(1));
    });

    fakeAsyncTest('resume leaves a pending edit alone', (clock) {
      final t = nowSeconds();
      start(clock).createSection('mine');
      relay.stored.add(relay.event('channel-sections', blob('peer'), t + 9));
      m.refreshFromRelay();
      clock.flushMicrotasks();
      expect(names(), ['mine']);
    });

    fakeAsyncTest('OK before echo keeps a coherent cursor', (clock) {
      start(clock).createSection('mine');
      clock.elapse(const Duration(seconds: 5));
      final own = relay.published.single;
      relay.emit(
        relay.event(
          'channel-sections',
          blob('peer'),
          own.createdAt,
          id: ''.padLeft(64, '0'),
        ),
      );
      clock.elapse(const Duration(milliseconds: 20));
      expect(names(), ['peer']);
    });
  });

  group('sort', () {
    late SidebarRelay relay;
    late ChannelSortManager m;
    setUp(() => relay = SidebarRelay());
    tearDown(() => m.dispose());

    ChannelSortManager start(FakeAsync clock) {
      m = ChannelSortManager(
        pubkey: relay.pubkey,
        relayUrl: 'wss://relay.example',
        prefs: prefs(),
        crypto: ChannelSortCrypto(relay.keys.nsec, relay.pubkey),
        relaySession: relay.session,
        signedEventRelay: relay.signer,
        remoteEnabled: true,
        onChanged: () {},
      )..initialize();
      clock.flushMicrotasks();
      return m;
    }

    NostrEvent recent(int t) => relay.event('channel-sort', {
      'version': 1,
      'groups': {'dms': 'recent'},
    }, t);

    fakeAsyncTest('resume adopts a head the healthy socket missed', (clock) {
      start(clock);
      relay.stored.add(recent(nowSeconds()));
      m.refreshFromRelay();
      clock.flushMicrotasks();
      expect(m.sortModeFor('dms'), ChannelSortMode.recent);
      expect(relay.reqsFor('channel-sort', 'l-'), hasLength(1));
    });

    fakeAsyncTest('resume leaves a pending edit alone', (clock) {
      start(clock).setSortModeFor('dms', ChannelSortMode.alpha);
      relay.stored.add(recent(nowSeconds() + 9));
      final reads = relay.reqsFor('channel-sort', 'h-').length;
      m.refreshFromRelay();
      clock.flushMicrotasks();
      expect(m.sortModeFor('dms'), ChannelSortMode.alpha);
      expect(relay.reqsFor('channel-sort', 'h-'), hasLength(reads));
    });
  });
}
