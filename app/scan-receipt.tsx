// Receipt capture (docs/plan/EXECUTE.md Phase 7, task 7.2): photograph a receipt, run
// on-device OCR (docs/ocr/OCR.md §2), and hand the parsed draft to the review gate (§5.6).
// Nothing here writes to the ledger — createReceiptArtifact only records the raw OCR result.
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from 'src/ui/theme';
import { fnv1a } from 'src/core/hash';
import { scanReceipt } from 'src/platform/ocr';
import { parseReceiptOcr } from 'src/parse/receipt';
import { useDatabase } from 'src/ui/DatabaseContext';
import { createReceiptArtifact } from 'src/db/queries/receipts';
import { findArtifactByFileHash } from 'src/db/queries/statements';

export default function ScanReceipt() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { db } = useDatabase();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCapture = async () => {
    setError(null);
    setCapturing(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.8 });
      if (!photo) throw new Error('No photo captured');

      const ocr = await scanReceipt(photo.uri);
      const parsed = parseReceiptOcr(ocr);
      const fileHash = fnv1a(ocr.text);

      const existing = await findArtifactByFileHash(db, fileHash);
      if (existing) {
        router.replace({ pathname: '/review/[artifactId]', params: { artifactId: existing.artifactId } });
        return;
      }

      const artifactId = await createReceiptArtifact(db, {
        fileUri: photo.uri,
        fileHash,
        rawText: ocr.text,
        parsedJson: JSON.stringify(parsed),
      });
      router.replace({ pathname: '/review/[artifactId]', params: { artifactId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
    }
  };

  if (!permission) {
    return <View style={[styles.container, { backgroundColor: theme.bgPrimary }]} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: theme.bgPrimary }]}>
        <Text style={{ color: theme.textPrimary }}>Pauti needs camera access to scan receipts.</Text>
        <Pressable onPress={requestPermission} style={[styles.primaryButton, { backgroundColor: theme.accentPrimary }]}>
          <Text style={{ color: theme.bgPrimary }}>Grant camera access</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      {error && <Text style={[styles.error, { color: theme.accentSecondary }]}>{error}</Text>}
      <Pressable
        disabled={capturing}
        onPress={handleCapture}
        style={[
          styles.primaryButton,
          { backgroundColor: capturing ? theme.bgSecondary : theme.accentPrimary, marginBottom: insets.bottom + 16 },
        ]}
      >
        <Text style={{ color: capturing ? theme.textSecondary : theme.bgPrimary }}>
          {capturing ? 'Scanning...' : 'Capture receipt'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center', gap: 12, padding: 16 },
  camera: { flex: 1 },
  error: { padding: 12 },
  primaryButton: { margin: 16, padding: 14, borderRadius: 8, alignItems: 'center' },
});
