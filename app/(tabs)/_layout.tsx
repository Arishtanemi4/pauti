import { Tabs } from 'expo-router';
import { useTheme } from 'src/ui/theme';

export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.bgPrimary },
        headerTintColor: theme.textPrimary,
        tabBarActiveTintColor: theme.accentPrimary,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.bgPrimary },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
      <Tabs.Screen name="add" options={{ title: 'Add' }} />
      <Tabs.Screen name="groups" options={{ title: 'Groups' }} />
    </Tabs>
  );
}
