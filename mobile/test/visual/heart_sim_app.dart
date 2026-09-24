import 'package:buzz/features/channels/reaction_row.dart';
import 'package:buzz/features/channels/timeline_message.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

// Native iOS visual fixture using production reaction widgets.
// flutter run -d <simulator> -t test/visual/heart_sim_app.dart
// xcrun simctl io <simulator> screenshot <path>
void main() => runApp(
  ProviderScope(
    child: MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      home: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 24),
                const Text('Reaction rendering'),
                const SizedBox(height: 24),
                const Text('Selected'),
                _reactions(true),
                const SizedBox(height: 24),
                const Text('Unselected'),
                _reactions(false),
              ],
            ),
          ),
        ),
      ),
    ),
  ),
);

Widget _reactions(bool selected) => ReactionRow(
  messageId: 'heart-$selected',
  reactions: [
    for (final emoji in ['❤️', '👍', '🎉'])
      TimelineReaction(
        emoji: emoji,
        count: 5,
        reactedByCurrentUser: selected,
        userPubkeys: const [],
      ),
  ],
  onToggle: (_) {},
);
