import { Ionicons } from '@expo/vector-icons';
import { useTranslations } from '@nomad/i18n';
import { colors } from '@nomad/ui';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { IconName } from '../IconButton';

export type LineTool = 'play' | 'edit' | 'resync' | 'nudge' | 'split' | 'merge' | 'insert' | 'delete';

const MAIN: { tool: LineTool | 'more'; icon: IconName }[] = [
  { tool: 'play', icon: 'play' },
  { tool: 'edit', icon: 'pencil' },
  { tool: 'resync', icon: 'sync' },
  { tool: 'nudge', icon: 'swap-horizontal' },
  { tool: 'more', icon: 'ellipsis-horizontal' },
];
const MORE: LineTool[] = ['split', 'merge', 'insert', 'delete'];

type Props = {
  index: number;
  canSplit: boolean;
  canMerge: boolean;
  onTool: (tool: LineTool, index: number) => void;
};

/** The selected line's actions: Play / Edit / Re-sync / Nudge, and ⋯ for the structural edits. */
export function LineToolbar({ index, canSplit, canMerge, onTool }: Props) {
  const t = useTranslations('review.tool');
  const [more, setMore] = useState(false);
  const enabled = (tool: LineTool) => (tool === 'split' ? canSplit : tool === 'merge' ? canMerge : true);

  return (
    <View className="mt-2 gap-2">
      <View className="flex-row rounded-xl bg-bg">
        {MAIN.map(({ tool, icon }) => {
          const on = tool === 'more' && more;
          return (
            <Pressable
              key={tool}
              testID={`review-tool-${tool}`}
              accessibilityRole="button"
              accessibilityLabel={t(tool)}
              accessibilityState={tool === 'more' ? { expanded: more } : undefined}
              onPress={() => (tool === 'more' ? setMore((m) => !m) : onTool(tool, index))}
              className="min-h-12 flex-1 items-center justify-center py-1"
            >
              <Ionicons name={icon} size={20} color={on ? colors.text : colors.primary} />
              <Text className="text-xs text-text" numberOfLines={1}>
                {t(tool)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {more ? (
        <View className="flex-row flex-wrap gap-2">
          {MORE.map((tool) => {
            const on = enabled(tool);
            return (
              <Pressable
                key={tool}
                testID={`review-tool-${tool}`}
                accessibilityRole="button"
                accessibilityLabel={t(tool)}
                accessibilityState={{ disabled: !on }}
                disabled={!on}
                onPress={() => onTool(tool, index)}
                className={`min-h-11 justify-center rounded-lg border border-border bg-bg px-3 ${on ? '' : 'opacity-40'}`}
              >
                <Text className={`text-base ${tool === 'delete' ? 'text-danger' : 'text-text'}`}>{t(tool)}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
