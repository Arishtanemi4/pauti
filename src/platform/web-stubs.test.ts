import { describe, expect, it } from 'vitest';
import { scanReceipt } from './ocr.web';
import { extractPdfText } from './pdf.web';

describe('web platform stubs', () => {
  it('scanReceipt throws on web, rather than failing silently', async () => {
    await expect(scanReceipt('file://x')).rejects.toThrow('not implemented on web');
  });

  it('extractPdfText throws on web, rather than failing silently', async () => {
    await expect(extractPdfText('file://x')).rejects.toThrow('not implemented on web');
  });
});
