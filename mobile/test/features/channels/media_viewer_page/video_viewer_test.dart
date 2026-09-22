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
//
// F2r(c): A VideoPlayerController created but never initialized (pending)
//         is disposed when the widget is unmounted.  Before the fix, the
//         controller lived only in the async function's stack frame; a close
//         arriving while initialize() was awaiting the initialized event left
//         the native player allocated forever.
//
// Transport: AbortableStreamedRequest sink must be closed before send().
//         Without it, IOClient.send() awaits stream.pipe(ioRequest) which
//         blocks until the sink is closed — every download hangs indefinitely
//         with the real http.Client.  Two probes: a local loopback server that
//         reads the full request body before replying (fails if sink is not
//         closed), and a MockClient-based fake that calls request.finalize()
//         for unit coverage.

import 'dart:async';
import 'dart:io';

import 'package:buzz/features/channels/media_viewer_page.dart';
import 'package:buzz/shared/relay/media_auth.dart';
import 'package:buzz/shared/relay/media_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
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
  final bool forceInitError;
  final bool neverInitialize;
  int disposeCallCount = 0;
  int nextPlayerId = 0;
  final Map<int, StreamController<VideoEvent>> _streams = {};

  _FakeVideoPlayerPlatform({
    this.forceInitError = false,
    this.neverInitialize = false,
  });

  @override
  Future<void> init() async {}

  @override
  Future<int?> createWithOptions(VideoCreationOptions options) async {
    return create(options.dataSource);
  }

  @override
  Future<int?> create(DataSource dataSource) async {
    final id = nextPlayerId++;
    final controller = StreamController<VideoEvent>(
      onListen: () {
        // Emit the event/error only when the stream is first subscribed so that
        // VideoPlayerController.initialize() is already listening.  Emitting
        // before the subscription means the event is dropped and initialize()
        // hangs waiting for the initialized signal.
        if (forceInitError) {
          _streams[id]!.addError(
            PlatformException(
              code: 'VideoError',
              message: 'Fake native init failure',
            ),
          );
        } else if (!neverInitialize) {
          _streams[id]!.add(
            VideoEvent(
              eventType: VideoEventType.initialized,
              size: const Size(100, 100),
              duration: const Duration(seconds: 1),
            ),
          );
        }
        // neverInitialize: no event emitted — initialize() hangs forever.
      },
    );
    _streams[id] = controller;
    return id;
  }

  @override
  Future<void> dispose(int playerId) async {
    disposeCallCount++;
    // Close the stream with an error so any pending initialize() call
    // (waiting for the initialized event) gets unblocked rather than hanging.
    // Without this, a neverInitialize fake causes the initializingCompleter
    // to wait forever, which leaves the initializeVideo() future pending after
    // the test ends — triggering "pending timers" framework warnings.
    final stream = _streams[playerId];
    if (stream != null) {
      if (!stream.isClosed) {
        stream.addError(
          StateError('VideoPlayerController disposed before initialization'),
        );
      }
      await stream.close();
    }
  }

  /// Return a minimal stand-in widget.  VideoPlayerPlatform.buildViewWithOptions
  /// delegates to this; without it every test that successfully initializes a
  /// player throws UnimplementedError when the VideoPlayer widget renders.
  @override
  Widget buildView(int playerId) => const SizedBox.shrink();

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

/// A fake [http.Client] that calls [request.finalize()] and drains the
/// request body before returning a response.  If the request sink is not
/// closed, finalize() returns an open stream and the drain hangs — which is
/// exactly what the sink-fix prevents.
class _FinalizingFakeClient extends http.BaseClient {
  final http.StreamedResponse Function() responseBuilder;
  bool requestBodyDrained = false;

  _FinalizingFakeClient({required this.responseBuilder});

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    // Drain the finalized request body.  If sink.close() was not called this
    // stream never ends and the test times out — verifying the transport fix.
    await request.finalize().drain<void>();
    requestBodyDrained = true;
    return responseBuilder();
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    PathProviderPlatform.instance = _FakePathProviderPlatform();
  });

  // Transport: request sink must be closed before send().
  //
  // Red-with-old-code: before the `unawaited(request.sink.close())` fix,
  // _FinalizingFakeClient.send() drained an open stream and the test timed
  // out.  With the fix the drain completes immediately, the download succeeds,
  // and the video controller initializes.
  testWidgets(
    'Transport: request sink is closed before send() — fake drain probe',
    (tester) async {
      final fakePlayer = _FakeVideoPlayerPlatform();
      VideoPlayerPlatform.instance = fakePlayer;

      final fakeClient = _FinalizingFakeClient(
        responseBuilder: () =>
            http.StreamedResponse(Stream.value(<int>[0, 1, 2, 3]), 200),
      );
      addTearDown(fakeClient.close);

      await tester.runAsync(() async {
        await tester.pumpWidget(
          WidgetHelpers.testable(
            disableAnimations: true,
            overrides: [
              mediaGetAuthServiceProvider.overrideWithValue(_noopAuth()),
              mediaHttpClientProvider.overrideWithValue(fakeClient),
            ],
            child: const MediaVideoViewerPage(
              videoUrl: 'https://relay.test/media/abc.mp4',
            ),
          ),
        );
        await Future<void>.delayed(const Duration(milliseconds: 300));
      });
      await tester.pump();

      expect(
        fakeClient.requestBodyDrained,
        isTrue,
        reason: 'request sink must be closed so send() can finalize the body',
      );
    },
  );

  // Transport: request sink must be closed before send().
  //
  // Real-IO loopback probes (TestWidgetsFlutterBinding intercepts HttpClient
  // within this suite) live in video_viewer_transport_test.dart, which uses
  // plain test() without TestWidgetsFlutterBinding.  The fake drain probe
  // below covers the same contract without the binding conflict.
  //
  //
  // Red-with-old-code: before the fix the `localController` was created but
  // only published to `controller.value` after a successful initialize()+play().
  // On error the outer `catch (loadError)` ran without ever calling
  // `localController.dispose()`.  With forceInitError=true the fake emits a
  // PlatformException; `initialize()` throws; the new inner catch calls
  // `dispose()` before rethrowing.  disposeCallCount >= 1 verifies it.
  testWidgets('F2r(a): VideoPlayerController is disposed when native init fails', (
    tester,
  ) async {
    final fakePlayer = _FakeVideoPlayerPlatform(forceInitError: true);
    VideoPlayerPlatform.instance = fakePlayer;

    // 200-ok response with a tiny immediate body so the download phase
    // completes and initializeVideo() reaches the VideoPlayerController.file()
    // path.  The _FinalizingFakeClient drains the request body, which proves
    // the sink is closed (if not, the drain hangs and the test times out).
    final fakeClient = _FinalizingFakeClient(
      responseBuilder: () =>
          http.StreamedResponse(Stream.value(<int>[0, 1, 2, 3]), 200),
    );
    addTearDown(fakeClient.close);

    await tester.runAsync(() async {
      await tester.pumpWidget(
        WidgetHelpers.testable(
          disableAnimations: true,
          overrides: [
            mediaGetAuthServiceProvider.overrideWithValue(_noopAuth()),
            mediaHttpClientProvider.overrideWithValue(fakeClient),
          ],
          child: const MediaVideoViewerPage(
            videoUrl: 'https://relay.test/media/abc.mp4',
          ),
        ),
      );
      // Give the initializeVideo() async chain time to complete: HTTP response,
      // file write, VideoPlayerController.initialize(), and dispose().
      await Future<void>.delayed(const Duration(milliseconds: 300));
    });
    await tester.pump();

    // The fake must have recorded at least one dispose() call, confirming
    // the native player was released even on an initialisation failure.
    expect(
      fakePlayer.disposeCallCount,
      greaterThanOrEqualTo(1),
      reason: 'VideoPlayerController must be disposed when initialize() throws',
    );
  });

  // F2r(b): close-during-error-body must cancel the stream and show the
  // error UI while the body is still open.
  //
  // Red-with-old-code: before the fix a 403 response body was consumed via
  // `response.stream.drain<void>()`, which suspends until the upstream closes
  // the stream.  With the fix, `_cancelVideoResponse(response)` subscribes and
  // immediately cancels.
  //
  // Discriminating assertion: (1) the body stream's onCancel fires while the
  // body is still open (never would with drain()), and (2) the error UI is
  // visible while the body remains open.  Restoring drain() breaks both.
  testWidgets('F2r(b): non-2xx error body is cancelled, not drained', (
    tester,
  ) async {
    final fakePlayer = _FakeVideoPlayerPlatform();
    VideoPlayerPlatform.instance = fakePlayer;

    // Body stream that NEVER closes — simulates a slow/stalled server.
    // drain() would block here indefinitely; _cancelVideoResponse completes
    // immediately by subscribing and cancelling.
    var bodyStreamCancelled = false;
    final stalledBody = StreamController<List<int>>(
      onCancel: () => bodyStreamCancelled = true,
    );
    addTearDown(stalledBody.close);

    final fakeClient = _FinalizingFakeClient(
      responseBuilder: () => _streamedResponse(403, stalledBody),
    );
    addTearDown(fakeClient.close);

    await tester.pumpWidget(
      WidgetHelpers.testable(
        disableAnimations: true,
        overrides: [
          mediaGetAuthServiceProvider.overrideWithValue(_noopAuth()),
          mediaHttpClientProvider.overrideWithValue(fakeClient),
        ],
        child: const MediaVideoViewerPage(
          videoUrl: 'https://relay.test/media/abc.mp4',
        ),
      ),
    );

    // Allow real async I/O to complete.  disableAnimations: true stops
    // BuzzLoadingIndicator from repeating, so pumpAndSettle converges.
    // drain() blocks here (body never closes); _cancelVideoResponse does not.
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
    await tester.pumpAndSettle();

    // (1) The body stream's onCancel must have fired — confirming listen+cancel
    //     was used, not drain().  With drain(), onCancel fires only when the
    //     whole drain completes (which never happens here).
    expect(
      bodyStreamCancelled,
      isTrue,
      reason:
          'error-body stream must be cancelled (listen+cancel), not drained',
    );

    // (2) The error UI must be visible while the body stream is still open
    //     (stalledBody was never closed).  _MediaLoadFailure shows this text
    //     when error.value is set — which only happens after _cancelVideoResponse
    //     completes and the HttpException propagates to the outer catch.
    //     With drain(), error.value is never set (drain hangs), so this
    //     assertion fails.
    expect(
      find.text('Failed to load video'),
      findsOneWidget,
      reason: 'error UI must be visible while the stalled body is still open',
    );

    // No controller is created before a 403 response.
    expect(
      fakePlayer.disposeCallCount,
      0,
      reason: 'No controller is created before a 403 response',
    );

    // (3) Explicitly unmount the viewer and verify no disposal fires from the
    //     teardown either — no controller was ever created.
    // Pass the same overrides so Riverpod's debug assertion
    // (_debugOverridesLength == overrides.length) does not fire.
    await tester.pumpWidget(
      WidgetHelpers.testable(
        disableAnimations: true,
        overrides: [
          mediaGetAuthServiceProvider.overrideWithValue(_noopAuth()),
          mediaHttpClientProvider.overrideWithValue(fakeClient),
        ],
        child: const SizedBox.shrink(),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      fakePlayer.disposeCallCount,
      0,
      reason: 'Unmounting after 403 must not dispose a non-existent controller',
    );
  });

  // F2r(c): VideoPlayerController created but never initialized must be
  // disposed when the widget is unmounted.
  //
  // Scenario: download succeeds, VideoPlayerController.file() is constructed
  // and registered in pendingController, but initialize() hangs forever (the
  // fake never emits an initialized event).  Unmounting fires the effect
  // cleanup which must dispose the pending controller via pendingController.
  //
  // Red-with-old-code: before the pendingController ref, localController lived
  // only in the async function's stack frame; the effect cleanup read only
  // controller.value (null until init completes) and disposed nothing — the
  // native player was leaked.
  testWidgets(
    'F2r(c): controller created but never initialized is disposed on unmount',
    (tester) async {
      final fakePlayer = _FakeVideoPlayerPlatform(neverInitialize: true);
      VideoPlayerPlatform.instance = fakePlayer;

      final fakeClient = _FinalizingFakeClient(
        responseBuilder: () =>
            http.StreamedResponse(Stream.value(<int>[0, 1, 2, 3]), 200),
      );
      addTearDown(fakeClient.close);

      await tester.runAsync(() async {
        await tester.pumpWidget(
          WidgetHelpers.testable(
            disableAnimations: true,
            overrides: [
              mediaGetAuthServiceProvider.overrideWithValue(_noopAuth()),
              mediaHttpClientProvider.overrideWithValue(fakeClient),
            ],
            child: const MediaVideoViewerPage(
              videoUrl: 'https://relay.test/media/abc.mp4',
            ),
          ),
        );
        // Allow enough time for the download to complete and for
        // VideoPlayerController.file() to be constructed, but NOT long
        // enough for initialize() to complete (it never will).
        await Future<void>.delayed(const Duration(milliseconds: 300));

        // Now unmount — this triggers the effect cleanup with the pending
        // controller still in pendingController.value (never reached play()).
        // Pass the same overrides so Riverpod's debug assertion
        // (_debugOverridesLength == overrides.length) does not fire.
        await tester.pumpWidget(
          WidgetHelpers.testable(
            disableAnimations: true,
            overrides: [
              mediaGetAuthServiceProvider.overrideWithValue(_noopAuth()),
              mediaHttpClientProvider.overrideWithValue(fakeClient),
            ],
            child: const SizedBox.shrink(),
          ),
        );
        await Future<void>.delayed(const Duration(milliseconds: 100));
      });
      await tester.pump();

      // The pending controller must have been disposed by the effect cleanup,
      // even though initialize() never returned.
      expect(
        fakePlayer.disposeCallCount,
        greaterThanOrEqualTo(1),
        reason:
            'pendingController must be disposed on unmount even if init never completes',
      );
    },
  );
}
