import { Stack } from 'expo-router';
import { DatabaseProvider } from 'src/ui/DatabaseContext';

export default function RootLayout() {
  return (
    <DatabaseProvider>
      <Stack />
    </DatabaseProvider>
  );
}
