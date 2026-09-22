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
//   The server waits for the client connection to close (signalled via a
//   Completer) so the test does not race against a fixed sleep.  The abort
//   fires after the server confirms request arrival; send() must throw the
//   typed RequestAbortedException within a bounded deadline.

import 'dart:async';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart' show IOClient;
import 'package:flutter_test/flutter_test.dart';

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

      final response = await client
          .send(request)
          .timeout(
            const Duration(seconds: 5),
            onTimeout: () =>
                throw TimeoutException('send() did not complete within 5 s'),
          );

      expect(
        response.statusCode,
        200,
        reason: 'sink closed → server receives full request → replies 200',
      );
      await response.stream.drain<void>().timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw TimeoutException(
          'response drain did not complete within 5 s',
        ),
      );
    },
  );

  test(
    'Transport: abort trigger cancels an in-flight download — real IO loopback',
    () async {
      // The server signals that the request has arrived (so the abort fires
      // AFTER the connection is established, not before).
      final requestArrivedCompleter = Completer<void>();

      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));

      // Use a Completer to let the server handler exit cleanly when the client
      // closes the connection (abort-induced socket close).  The server listen
      // callback completes the Completer; addTearDown ensures the handler is
      // released even if the test fails.
      final serverDone = Completer<void>();
      server.listen((req) async {
        await req.drain<void>();
        // Signal that the server has received the request.
        if (!requestArrivedCompleter.isCompleted) {
          requestArrivedCompleter.complete();
        }
        // Hold the response open.  The abort closes the socket and causes
        // dart:io to surface a SocketException here, which completes serverDone.
        try {
          await req.response.close();
        } catch (_) {
          // Socket closed by client abort — expected.
        } finally {
          if (!serverDone.isCompleted) serverDone.complete();
        }
      });
      addTearDown(() async {
        if (!serverDone.isCompleted) serverDone.complete();
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

      // Start the request, wait for server-arrival confirmation, then abort.
      final sendFuture = client.send(request);
      // Bounded wait: if the server doesn't see the request within 5s, fail.
      await requestArrivedCompleter.future.timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw TimeoutException(
          'Loopback server did not receive request within 5 s',
        ),
      );
      requestAbort.complete();

      // send() must throw RequestAbortedException within a bounded deadline.
      // The typed assertion distinguishes an abort from any other exception.
      await expectLater(
        sendFuture.timeout(const Duration(seconds: 5)),
        throwsA(isA<http.RequestAbortedException>()),
        reason: 'abort must cause send() to throw RequestAbortedException',
      );
    },
  );
}
