// Real-IO transport probes for MediaVideoViewerPage.
//
// These tests exercise the actual IOClient (dart:io) transport path for
// AbortableStreamedRequest.  They are intentionally in a SEPARATE file
// from video_viewer_test.dart because TestWidgetsFlutterBinding.ensureInitialized()
// in the main test file installs a suite-wide HttpClient override that returns
// status 400 for ALL requests — including plain test() calls in the same suite.
// By isolating these here, the real loopback HttpServer can be reached.
//
// Transport probe #1: request sink must be closed before send().
//   A local loopback server reads the full request body before replying.
//   Without the `unawaited(request.sink.close())` fix, IOClient.send() blocks
//   at `stream.pipe(ioRequest)` forever — test times out.
//
// Transport probe #2: abort trigger cancels an in-flight download.
//   The server delays its response; the abort fires first and send() throws.

import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart' show IOClient;
import 'package:test/test.dart';

void main() {
  test(
    'Transport: request sink is closed — real IO loopback probe (success)',
    () async {
      final videoBytes = <int>[0, 1, 2, 3];

      // Start a local HTTP server that reads the full request body BEFORE
      // sending the response.  If the sink is not closed, the drain hangs.
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));

      server.listen((req) async {
        await req.drain<void>(); // hangs if sink was not closed
        req.response
          ..statusCode = 200
          ..headers.contentType = ContentType('video', 'mp4')
          ..contentLength = videoBytes.length
          ..add(videoBytes);
        await req.response.close();
      });

      final serverUrl =
          'http://${server.address.host}:${server.port}/video.mp4';
      final client = IOClient(
        HttpClient()..idleTimeout = const Duration(milliseconds: 1),
      );
      addTearDown(client.close);

      final requestAbort = Completer<void>();
      final request = http.AbortableStreamedRequest(
        'GET',
        Uri.parse(serverUrl),
        abortTrigger: requestAbort.future,
      );
      // THE FIX: close the sink before send so the pipe completes.
      unawaited(request.sink.close());

      final response = await client.send(request);

      expect(
        response.statusCode,
        200,
        reason: 'sink closed → server receives full request → replies 200',
      );
      await response.stream.drain<void>();
    },
  );

  test(
    'Transport: abort trigger cancels an in-flight download — real IO loopback',
    () async {
      // Server that stalls after reading the request body.
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));

      server.listen((req) async {
        await req.drain<void>();
        // Intentionally delay — the abort closes the connection before this.
        await Future<void>.delayed(const Duration(seconds: 60));
        await req.response.close();
      });

      final serverUrl =
          'http://${server.address.host}:${server.port}/video.mp4';
      final client = IOClient(
        HttpClient()..idleTimeout = const Duration(milliseconds: 1),
      );
      addTearDown(client.close);

      final requestAbort = Completer<void>();
      final request = http.AbortableStreamedRequest(
        'GET',
        Uri.parse(serverUrl),
        abortTrigger: requestAbort.future,
      );
      unawaited(request.sink.close());

      // Start the request, give it time to reach the server, then abort.
      final sendFuture = client.send(request);
      await Future<void>.delayed(const Duration(milliseconds: 100));
      requestAbort.complete();

      // send() must throw because the abort fires before the response.
      Object? caughtError;
      try {
        await sendFuture;
      } catch (e) {
        caughtError = e;
      }
      expect(
        caughtError,
        isNotNull,
        reason: 'abort must cause send() to throw',
      );
    },
  );
}
