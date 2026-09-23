import 'package:flutter/widgets.dart';
import 'package:gpt_markdown/gpt_markdown.dart';

import 'native_emoji_style.dart';

/// Paints native emoji with color fonts while preserving surrounding typography.
///
/// Match complete grapheme clusters from this message so selectors, skin tones,
/// flags, keycaps and ZWJ sequences stay together. Text-presentation sequences
/// using VS15 and default-text symbols without VS16 keep their text appearance.
class NativeEmojiMd extends InlineMd {
  /// Creates a component matching only the emoji present in [content].
  NativeEmojiMd(String content) : _exp = _pattern(content);

  final RegExp _exp;
  static final _emoji = RegExp(
    r'\p{Emoji_Presentation}|\uFE0F|\u20E3',
    unicode: true,
  );

  static RegExp _pattern(String content) {
    final clusters =
        content.characters
            .where(
              (cluster) =>
                  !cluster.contains('\uFE0E') && _emoji.hasMatch(cluster),
            )
            .toSet()
            .toList()
          ..sort((a, b) => b.length.compareTo(a.length));
    if (clusters.isEmpty) return RegExp(r'(?!x)x');
    // A shorter emoji elsewhere in the message must not consume the start of
    // an explicit text-presentation or a longer emoji sequence.
    return RegExp(
      '(?:${clusters.map(RegExp.escape).join('|')})'
      r'(?![\uFE0E\uFE0F\u200D\u20E3]|\uD83C[\uDFFB-\uDFFF])',
    );
  }

  @override
  RegExp get exp => _exp;

  @override
  InlineSpan span(BuildContext context, String text, GptMarkdownConfig config) {
    return TextSpan(
      text: text,
      style: (config.style ?? const TextStyle()).merge(nativeEmojiTextStyle),
    );
  }
}
