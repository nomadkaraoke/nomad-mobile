import { Ionicons } from '@expo/vector-icons';
import { useTranslations } from '@nomad/i18n';
import { colors } from '@nomad/ui';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';

type IconName = ComponentProps<typeof Ionicons>['name'];

// Spec §4.1: Discover, Tonight, Make, Me.
const TABS: { name: 'discover' | 'tonight' | 'make' | 'me'; icon: IconName }[] = [
  { name: 'discover', icon: 'search' },
  { name: 'tonight', icon: 'moon' },
  { name: 'make', icon: 'sparkles' },
  { name: 'me', icon: 'person' },
];

export default function TabsLayout() {
  const t = useTranslations('tabs');
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
      }}
    >
      {TABS.map(({ name, icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: t(name),
            tabBarButtonTestID: `tab-${name}`,
            tabBarIcon: ({ color, size }) => <Ionicons name={icon} color={color} size={size} />,
          }}
        />
      ))}
    </Tabs>
  );
}
