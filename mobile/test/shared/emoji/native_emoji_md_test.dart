import 'package:buzz/features/channels/message_content.dart';
import 'package:buzz/shared/emoji/native_emoji_md.dart';
import 'package:buzz/shared/emoji/native_emoji_style.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:buzz/shared/custom_emoji/custom_emoji_provider.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../helpers/widget_helpers.dart';

Iterable<TextSpan> _spans(InlineSpan span) sync* {
  if (span is TextSpan) {
    yield span;
    for (final child in span.children ?? <InlineSpan>[]) {
      yield* _spans(child);
    }
  }
}

void main() {
  test('keeps emoji graphemes intact and respects text presentation', () {
    const content =
        '❤ ❤️ ❤️‍🔥 ❤️‍🩹 ❤︎ 👍🏽 👩‍👩‍👧‍👦 🇺🇸 1️⃣ #️⃣ © ™ ® text';
    final component = NativeEmojiMd(content);
    expect(component.exp.allMatches(content).map((match) => match.group(0)), [
      '❤️',
      '❤️‍🔥',
      '❤️‍🩹',
      '👍🏽',
      '👩‍👩‍👧‍👦',
      '🇺🇸',
      '1️⃣',
      '#️⃣',
    ]);
    expect(
      NativeEmojiMd('plain text 123').exp.hasMatch('plain text 123'),
      isFalse,
    );
  });

  testWidgets('message emoji use color fonts without changing prose or code', (
    tester,
  ) async {
    const content =
        'Thanks ❤️ **great ❤️** ❤︎ `❤️` [love ❤️](https://example.com)';
    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: [customEmojiListProvider.overrideWithValue(const [])],
        child: const AppMarkdownTheme(
          child: MessageContent(
            content: content,
            channelNames: {'general': 'general'},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final spans = tester
        .widgetList<RichText>(
          find.byWidgetPredicate((widget) => widget is RichText),
        )
        .expand((richText) => _spans(richText.text))
        .toList();
    final emojiSpans = spans.where(
      (span) => span.style?.fontFamily == nativeEmojiTextStyle.fontFamily,
    );
    expect(emojiSpans.map((span) => span.text), ['❤️', '❤️', '❤️']);
    expect(
      emojiSpans.any((span) => span.style?.fontWeight == FontWeight.bold),
      isTrue,
    );
    expect(
      spans.any(
        (span) =>
            (span.text?.contains('Thanks') ?? false) &&
            span.style?.fontFamily == 'Inter',
      ),
      isTrue,
    );
    expect(
      spans.any(
        (span) => span.text == '❤️' && span.style?.fontFamily == 'GeistMono',
      ),
      isTrue,
    );
    expect(
      emojiSpans.any((span) => span.text?.contains('\uFE0E') ?? false),
      isFalse,
    );
  });
}
