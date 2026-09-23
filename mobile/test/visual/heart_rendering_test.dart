import 'dart:io';
import 'dart:ui' as ui;

import 'package:buzz/features/channels/message_content.dart';
import 'package:buzz/features/channels/reaction_row.dart';
import 'package:buzz/features/channels/timeline_message.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:buzz/shared/custom_emoji/custom_emoji_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

// Run on macOS to exercise real Inter and Apple color-emoji glyphs. The normal
// widget-test font (Ahem) cannot distinguish a red emoji from a black symbol.
// Optionally set HEART_SCREENSHOT to a PNG path to capture the real widgets.
void main() {
  testWidgets(
    'hearts render in color in reactions and message bodies',
    (tester) async {
      await tester.runAsync(() async {
        final inter = FontLoader('Inter')
          ..addFont(rootBundle.load('assets/fonts/InterVariable.ttf'));
        await inter.load();
        final emoji = FontLoader('Apple Color Emoji')
          ..addFont(
            File(
              '/System/Library/Fonts/Apple Color Emoji.ttc',
            ).readAsBytes().then((bytes) => bytes.buffer.asByteData()),
          );
        await emoji.load();
      });
      final scene = GlobalKey();
      final reaction = GlobalKey();
      final message = GlobalKey();
      final emojiOnly = GlobalKey();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [customEmojiListProvider.overrideWithValue(const [])],
          child: MaterialApp(
            theme: AppTheme.light(),
            home: Scaffold(
              body: Center(
                child: RepaintBoundary(
                  key: scene,
                  child: Container(
                    width: 360,
                    color: Colors.white,
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Reactions'),
                        const SizedBox(height: 8),
                        RepaintBoundary(
                          key: reaction,
                          child: ReactionRow(
                            messageId: 'heart',
                            reactions: const [
                              TimelineReaction(
                                emoji: '❤️',
                                count: 5,
                                reactedByCurrentUser: true,
                                userPubkeys: [],
                              ),
                            ],
                            onToggle: (_) {},
                          ),
                        ),
                        const SizedBox(height: 24),
                        const Text('Message text'),
                        const SizedBox(height: 8),
                        RepaintBoundary(
                          key: message,
                          child: const MessageContent(
                            content: 'Thanks for the release ❤️ **Love it ❤️**',
                            channelNames: {'general': 'general'},
                          ),
                        ),
                        const SizedBox(height: 24),
                        const Text('Emoji-only message'),
                        const SizedBox(height: 8),
                        RepaintBoundary(
                          key: emojiOnly,
                          child: const MessageContent(
                            content: '❤️',
                            channelNames: {'general': 'general'},
                            scaleEmojiOnly: true,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.runAsync(() async {
        final screenshot = Platform.environment['HEART_SCREENSHOT'];
        if (screenshot != null) {
          final image = await _capture(scene);
          final png = (await image.toByteData(format: ui.ImageByteFormat.png))!;
          await File(screenshot).parent.create(recursive: true);
          await File(screenshot).writeAsBytes(png.buffer.asUint8List());
          image.dispose();
        }
        for (final entry in {
          'reaction': reaction,
          'message': message,
          'emoji-only message': emojiOnly,
        }.entries) {
          final image = await _capture(entry.value);
          final rgba = (await image.toByteData(
            format: ui.ImageByteFormat.rawRgba,
          ))!;
          var redPixels = 0;
          for (var i = 0; i < rgba.lengthInBytes; i += 4) {
            final red = rgba.getUint8(i);
            if (red > 140 &&
                red > rgba.getUint8(i + 1) * 1.5 &&
                red > rgba.getUint8(i + 2) * 1.5 &&
                rgba.getUint8(i + 3) > 200) {
              redPixels++;
            }
          }
          image.dispose();
          expect(
            redPixels,
            greaterThan(20),
            reason:
                '${entry.key} must contain red emoji, not monochrome hearts',
          );
        }
      });
    },
    skip: !Platform.isMacOS,
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );
}

Future<ui.Image> _capture(GlobalKey key) {
  final boundary =
      key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  return boundary.toImage(pixelRatio: 3);
}
