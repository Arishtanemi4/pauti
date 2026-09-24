import { Stack } from 'expo-router';
import { DatabaseProvider, useDatabase } from 'src/ui/DatabaseContext';
import Onboarding from './onboarding';

// Gates the whole app behind first-run identity setup (docs/plan/EXECUTE.md Phase 8): nothing
// under app/(tabs) etc. assumes an empty selfUserId, so it's simpler to block here than to add
// that guard to every screen.
function Gate() {
  const { selfUserId } = useDatabase();
  return selfUserId ? <Stack /> : <Onboarding />;
}

export default function RootLayout() {
  return (
    <DatabaseProvider>
      <Gate />
    </DatabaseProvider>
  );
}
