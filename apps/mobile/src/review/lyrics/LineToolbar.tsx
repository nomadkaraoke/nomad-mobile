import { Ionicons } from '@expo/vector-icons';
import { useTranslations } from '@nomad/i18n';
import { colors, StartText } from '@nomad/ui';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

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

/** Longest label kept on one line (about what a fifth of a phone's width holds at text-xs): "Play line". */
const ONE_LINE_MAX = 9;

/**
 * A toolbar label laid out as at most two lines: a long one is broken at the space nearest its middle
 * ("Neu\nsynchronisieren"). The break is explicit: Android drew a two-word Hebrew label on one line, over its
 * neighbours, rather than wrapping it in its column. Whatever still doesn't fit shrinks (adjustsFontSizeToFit).
 */
export function toolbarLabel(label: string): { text: string; lines: 1 | 2 } {
  const words = label.trim().split(/\s+/);
  if (words.length < 2 || words.join(' ').length <= ONE_LINE_MAX) return { text: words.join(' '), lines: 1 };
  const total = words.join(' ').length;
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(' ').length * 2 - total);
    if (diff < bestDiff) {
      best = i;
      bestDiff = diff;
    }
  }
  return { text: `${words.slice(0, best).join(' ')}\n${words.slice(best).join(' ')}`, lines: 2 };
}

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
          const label = toolbarLabel(t(tool));
          return (
            <Pressable
              key={tool}
              testID={`review-tool-${tool}`}
              accessibilityRole="button"
              accessibilityLabel={t(tool)}
              accessibilityState={tool === 'more' ? { expanded: more } : undefined}
              onPress={() => (tool === 'more' ? setMore((m) => !m) : onTool(tool, index))}
              className="min-h-12 flex-1 items-center justify-start px-0.5 py-1"
            >
              <Ionicons name={icon} size={20} color={on ? colors.text : colors.primary} />
              {/* Five equal columns: a long label (he, de, ru) takes two lines and shrinks to fit rather than running
                  into its neighbours or breaking mid-word ("Verschiebe-n"). */}
              <StartText
                testID={`review-tool-${tool}-label`}
                className="self-stretch text-center text-xs text-text"
                numberOfLines={label.lines}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {label.text}
              </StartText>
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
                <StartText className={`text-base ${tool === 'delete' ? 'text-danger' : 'text-text'}`}>{t(tool)}</StartText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
