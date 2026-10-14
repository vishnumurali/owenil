import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

export function validateReceiptFile(file: File): string | null {
  if (!RECEIPT_TYPES.includes(file.type)) return 'Use a JPG, PNG, WebP, HEIC or PDF file.';
  if (file.size > RECEIPT_MAX_BYTES) return 'Receipts must be 5 MB or smaller.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

export interface ReceiptMetaInput {
  merchant?: string | null;
  receipt_date?: string | null;
  currency?: string | null;
  tax_minor?: number | null;
  tip_minor?: number | null;
  total_minor?: number | null;
}

/**
 * Uploads a receipt into the caller's private folder and records its metadata.
 * Storage rules (server-side) require Owenil Plus and the owner's own folder.
 */
export async function uploadReceipt(userId: string, file: File | null, meta: ReceiptMetaInput): Promise<string> {
  const id = crypto.randomUUID();
  let storage_path: string | null = null;
  if (file) {
    const err = validateReceiptFile(file);
    if (err) throw new Error(err);
    const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1] ?? 'jpg';
    storage_path = `${userId}/${id}.${ext}`;
    const { error } = await supabase.storage.from('receipts').upload(storage_path, file, { contentType: file.type, upsert: false, cacheControl: '3600' });
    if (error) {
      if (/bucket not found/i.test(error.message)) throw new Error('Receipt storage isn’t configured yet (see README → Receipts). The expense can still be saved without an image.');
      throw error;
    }
  }
  unwrap(
    await supabase.from('receipt_metadata').insert({
      id,
      owner_id: userId,
      storage_path,
      mime_type: file?.type ?? null,
      size_bytes: file?.size ?? null,
      merchant: meta.merchant || null,
      receipt_date: meta.receipt_date || null,
      currency: meta.currency || null,
      tax_minor: meta.tax_minor ?? null,
      tip_minor: meta.tip_minor ?? null,
      total_minor: meta.total_minor ?? null,
    }),
  );
  return id;
}

/** Short-lived signed URL — receipts are never public. */
export async function receiptUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 300);
  if (error) return null;
  return data.signedUrl;
}
