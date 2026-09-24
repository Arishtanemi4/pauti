import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SqliteExecutor } from '../db/migrations/runner';
import { initDatabase } from '../db/init';
import { openDatabase } from '../platform/sqlite';

interface DatabaseContextValue {
  db: SqliteExecutor;
  selfUserId: string;
  selfDeviceId: string;
  /** Re-reads the self user/device rows — called by app/onboarding.tsx once it creates them. */
  refreshSelf: () => Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

async function loadSelf(db: SqliteExecutor): Promise<{ selfUserId: string; selfDeviceId: string }> {
  const [self] = await db.getAllAsync<{ user_id: string }>('SELECT user_id FROM users WHERE is_self = 1');
  const [device] = await db.getAllAsync<{ device_id: string }>('SELECT device_id FROM devices WHERE is_self = 1');
  return { selfUserId: self?.user_id ?? '', selfDeviceId: device?.device_id ?? '' };
}

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<DatabaseContextValue | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openDatabase();
        await initDatabase(db);
        const self = await loadSelf(db);
        if (!cancelled) {
          setValue({
            db,
            ...self,
            refreshSelf: async () => {
              const refreshed = await loadSelf(db);
              setValue((v) => (v ? { ...v, ...refreshed } : v));
            },
          });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Text>Database error: {error.message}</Text>
      </View>
    );
  }

  if (!value) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
}

export function useDatabase(): DatabaseContextValue {
  const ctx = useContext(DatabaseContext);
  if (!ctx) {
    throw new Error('useDatabase must be used within DatabaseProvider');
  }
  return ctx;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
