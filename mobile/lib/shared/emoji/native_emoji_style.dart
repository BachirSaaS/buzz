import 'package:flutter/painting.dart';

/// Prefer color emoji fonts over monochrome symbols in the surrounding font.
///
/// Inter contains a heart glyph, so a fallback after Inter never gets selected
/// for it, even when the text includes the emoji presentation selector.
const nativeEmojiTextStyle = TextStyle(
  fontFamily: 'Apple Color Emoji',
  fontFamilyFallback: ['Noto Color Emoji', 'Segoe UI Emoji'],
);
