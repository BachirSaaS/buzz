// Regression tests for MediaVideoViewerPage lifecycle fixes:
//
// F2r(a): VideoPlayerController is disposed when native initialisation fails.
//         Before the fix, a PlatformException from initialize() unwound to the
//         outer catch with controller.value still null — the cleanup teardown's
//         `if (activeController != null)` guard silently skipped disposal,
//         leaking the native player and its event subscription.
//
// F2r(b): A non-2xx error-body is cancelled (listen+cancel) rather than
//         drained.  Before the fix, `response.stream.drain()` waited for the
//         server to close the stream — a stalled error body (e.g. a 403 on
//         a slow connection) could block initializeVideo indefinitely, and
//         there was no abort handle to cancel it.

import 'dart:async';
import 'dart:io';

import 'package:buzz/features/channels/media_viewer_page.dart';
import 'package:buzz/shared/relay/media_auth.dart';
import 'package:buzz/shared/relay/media_image.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:video_player_platform_interface/video_player_platform_interface.dart';

import '../../../helpers/widget_helpers.dart';

// ── Fakes ────────────────────────────────────────────────────────────────────

/// Minimal fake for path_provider so getTemporaryDirectory() works in tests.
/// Uses MockPlatformInterfaceMixin to bypass PlatformInterface.verify().
class _FakePathProviderPlatform extends Fake
    with MockPlatformInterfaceMixin
    implements PathProviderPlatform {
  @override
  Future<String?> getTemporaryPath() async =>
      Directory.systemTemp.resolveSymbolicLinksSync();
}

/// Fake VideoPlayerPlatform that tracks `dispose` calls and optionally
/// forces native initialisation to fail with a PlatformException.
///
/// Extends VideoPlayerPlatform directly (inheriting the platform token from the
/// super constructor) so PlatformInterface.verify() succeeds without needing
/// MockPlatformInterfaceMixin.
class _FakeVideoPlayerPlatform extends VideoPlayerPlatform {
  bool forceInitError;
  int disposeCallCount = 0;
  int nextPlayerId = 0;
  final Map<int, StreamController<VideoEvent>> _streams = {};

  _FakeVideoPlayerPlatform({this.forceInitError = false});

  @override
  Future<void> init() async {}

  @override
  Future<int?> createWithOptions(VideoCreationOptions options) async {
    return create(options.dataSource);
  }

  @override
  Future<int?> create(DataSource dataSource) async {
    final id = nextPlayerId++;
    final controller = StreamController<VideoEvent>();
    _streams[id] = controller;
    if (forceInitError) {
      controller.addError(
        PlatformException(
          code: 'VideoError',
          message: 'Fake native init failure',
        ),
      );
    } else {
      controller.add(
        VideoEvent(
          eventType: VideoEventType.initialized,
          size: const Size(100, 100),
          duration: const Duration(seconds: 1),
        ),
      );
    }
    return id;
  }

  @override
  Future<void> dispose(int playerId) async {
    disposeCallCount++;
    await _streams[playerId]?.close();
  }

  @override
  Stream<VideoEvent> videoEventsFor(int playerId) => _streams[playerId]!.stream;

  @override
  Future<void> play(int playerId) async {}

  @override
  Future<void> pause(int playerId) async {}

  @override
  Future<void> setLooping(int playerId, bool looping) async {}

  @override
  Future<void> setVolume(int playerId, double volume) async {}

  @override
  Future<void> seekTo(int playerId, Duration position) async {}

  @override
  Future<void> setPlaybackSpeed(int playerId, double speed) async {}

  @override
  Future<Duration> getPosition(int playerId) async => Duration.zero;

  @override
  Future<void> setMixWithOthers(bool mixWithOthers) async {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Returns a [http.StreamedResponse] with the given [statusCode] whose body
/// stream is controlled by [bodyController].  The caller closes [bodyController]
/// to release a drain; leaving it open proves that the fix (listen+cancel)
/// completes without waiting for the stream to close.
http.StreamedResponse _streamedResponse(
  int statusCode,
  StreamController<List<int>> bodyController,
) => http.StreamedResponse(bodyController.stream, statusCode);

/// A no-op auth service (returns empty headers for any URL, including
/// non-relay URLs so the test media URL does not need a signed nsec).
MediaGetAuthService _noopAuth() =>
    MediaGetAuthService(baseUrl: 'https://relay.test', nsec: null);

// ── Tests ─────────────────────────────────────────────────────────────────────

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    PathProviderPlatform.instance = _FakePathProviderPlatform();
  });

  // F2r(a): native initialisation failure must dispose the controller.
  //
  // Red-with-old-code: before the fix the `localController` was created but
  // only published to `controller.value` after a successful initialize()+play().
  // On error the outer `catch (loadError)` ran without ever calling
  // `localController.dispose()`.  With forceInitError=true the fake emits a
  // PlatformException; `initialize()` throws; the new inner catch calls
  // `dispose()` before rethrowing.  disposeCallCount >= 1 verifies it.
  testWidgets(
    'F2r(a): VideoPlayerController is disposed when native init fails',
    (tester) async {
      final fakePlayer = _FakeVideoPlayerPlatform(forceInitError: true);
      VideoPlayerPlatform.instance = fakePlayer;

      // 200-ok response with an immediately-completed body so the download
      // phase completes and initializeVideo() reaches the
      // VideoPlayerController.file() path.
      final client = http_testing.MockClient((request) async {
        return http.Response.bytes(<int>[0, 1, 2, 3], 200);
      });
      addTearDown(client.close);

      await tester.pumpWidget(
        WidgetHelpers.testable(
          overrides: [
            mediaGetAuthServiceProvider.overrideWithValue(_noopAuth()),
            mediaHttpClientProvider.overrideWithValue(client),
          ],
          child: const MediaVideoViewerPage(
            videoUrl: 'https://relay.test/media/abc.mp4',
          ),
        ),
      );

      // Pump until idle — initializeVideo() completes after catching the
      // PlatformException and recording the error.
      await tester.pumpAndSettle(const Duration(seconds: 5));

      // The fake must have recorded at least one dispose() call, confirming
      // the native player was released even on an initialisation failure.
      expect(
        fakePlayer.disposeCallCount,
        greaterThanOrEqualTo(1),
        reason:
            'VideoPlayerController must be disposed when initialize() throws',
      );
    },
  );

  // F2r(b): close-during-error-body must cancel the stream, not drain it.
  //
  // Red-with-old-code: before the fix a 403 response body was consumed via
  // `response.stream.drain<void>()`, which suspends until the upstream closes
  // the stream.  A stalled server body (bodyController never closed) would
  // block initializeVideo() indefinitely — pumpAndSettle would timeout.
  // With the fix, `_cancelVideoResponse(response)` subscribes and immediately
  // cancels, completing regardless of whether the body stream ever closes.
  // initializeVideo() then throws HttpException, the outer catch sets
  // error.value, and pumpAndSettle returns within the test timeout.
  testWidgets('F2r(b): non-2xx error body is cancelled, not drained', (
    tester,
  ) async {
    final fakePlayer = _FakeVideoPlayerPlatform();
    VideoPlayerPlatform.instance = fakePlayer;

    // Body stream that NEVER closes — simulates a slow/stalled server.
    // drain() would block here; _cancelVideoResponse completes immediately.
    final stalledBody = StreamController<List<int>>();
    addTearDown(stalledBody.close);

    final client = http_testing.MockClient.streaming(
      (request, bodyStream) async => _streamedResponse(403, stalledBody),
    );
    addTearDown(client.close);

    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: [
          mediaGetAuthServiceProvider.overrideWithValue(_noopAuth()),
          mediaHttpClientProvider.overrideWithValue(client),
        ],
        child: const MediaVideoViewerPage(
          videoUrl: 'https://relay.test/media/abc.mp4',
        ),
      ),
    );

    // Must settle within the short window — a stalled drain() would block
    // until the Flutter test runner's outer timeout kills the test.
    await tester.pumpAndSettle(const Duration(seconds: 5));

    // The error response was rejected before any VideoPlayerController was
    // created, so no dispose() calls should have been recorded.
    expect(
      fakePlayer.disposeCallCount,
      0,
      reason: 'No controller is created before a 403 response',
    );
  });
}
