import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';

/** Country assumed for numbers saved without a +country code (Owenil is India-first). */
export const DEFAULT_PHONE_COUNTRY: CountryCode = 'IN';

/**
 * E.164 form (+919876543210) of a phone number as people type or save it
 * ("098765 43210", "+91 98765-43210", "0091…"), or null if it isn't valid.
 */
export function normalizePhone(input: string, country: CountryCode = DEFAULT_PHONE_COUNTRY): string | null {
  const trimmed = input.trim().replace(/^00/, '+');
  if (!/\d/.test(trimmed)) return null;
  const phone = parsePhoneNumberFromString(trimmed, country);
  return phone && phone.isValid() ? phone.number : null;
}

/** Readable international form, e.g. "+91 98765 43210". */
export function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

export interface ContactKey {
  kind: 'email' | 'phone';
  /** Lower-case email, or E.164 phone number. */
  value: string;
}

/** An email or phone number typed into "Add friend". */
export function parseContactInput(input: string): ContactKey | null {
  if (input.includes('@')) {
    const email = normalizeEmail(input);
    return email ? { kind: 'email', value: email } : null;
  }
  const phone = normalizePhone(input);
  return phone ? { kind: 'phone', value: phone } : null;
}

/** Hex SHA-256, the same one-way code the database keeps for emails and phone numbers. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type Relation = 'self' | 'friend' | 'incoming' | 'requested' | 'none';

export interface FoundPerson {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  avatar_color: string;
  relation: Relation;
}

const BATCH = 2000;

/**
 * Which of these emails / E.164 numbers belong to people on Owenil (who allow
 * being found). Only one-way codes leave the device. The map is keyed by the
 * values passed in; values with no match are absent.
 */
export async function findPeople(values: string[]): Promise<Map<string, FoundPerson>> {
  const unique = [...new Set(values)];
  const hashes = await Promise.all(unique.map(sha256Hex));
  const valueOf = new Map(hashes.map((h, i) => [h, unique[i]!]));
  const found = new Map<string, FoundPerson>();
  for (let i = 0; i < hashes.length; i += BATCH) {
    const rows = unwrap(await supabase.rpc('find_people', { p_hashes: hashes.slice(i, i + BATCH) })) as (FoundPerson & { hash: string })[];
    for (const { hash, ...person } of rows ?? []) {
      const value = valueOf.get(hash);
      if (value) found.set(value, person);
    }
  }
  return found;
}

/** Adds someone found by email or phone: 'friends' straight away, or 'requested' (they accept). */
export async function requestFriend(userId: string): Promise<'friends' | 'requested'> {
  return unwrap(await supabase.rpc('request_friend', { p_user_id: userId })) as 'friends' | 'requested';
}

/** Saves the signed-in user's phone number (E.164); empty removes it. Returns what was stored. */
export async function saveMyPhone(e164: string | null): Promise<string | null> {
  return unwrap(await supabase.rpc('set_my_phone', { p_phone: e164 ?? '' })) as string | null;
}

/** An address-book entry as saved on the phone. */
export interface AddressBookEntry {
  name: string;
  phones: string[];
  emails: string[];
}

export interface ContactMatch {
  /** Name as saved on the phone. */
  name: string;
  /** First valid phone number (E.164) and email, used for inviting. */
  phone: string | null;
  email: string | null;
  /** The Owenil account behind this contact, if any. */
  person: FoundPerson | null;
}

/**
 * Checks a whole address book: who is already on Owenil (each person once) and
 * who could be invited (each number or email once). Entries without a valid
 * phone number or email are skipped.
 */
export async function matchAddressBook(entries: AddressBookEntry[]): Promise<ContactMatch[]> {
  const prepared = entries
    .map((c) => {
      const phones = [...new Set(c.phones.map((p) => normalizePhone(p)).filter((p): p is string => !!p))];
      const emails = [...new Set(c.emails.map(normalizeEmail).filter((e): e is string => !!e))];
      return { name: c.name.trim() || phones[0] || emails[0] || '', phones, emails };
    })
    .filter((c) => c.phones.length > 0 || c.emails.length > 0);
  const found = await findPeople(prepared.flatMap((c) => [...c.phones, ...c.emails]));
  const seenPeople = new Set<string>();
  const seenKeys = new Set<string>();
  const out: ContactMatch[] = [];
  for (const c of prepared) {
    const keys = [...c.phones, ...c.emails];
    const person = keys.map((k) => found.get(k)).find((p) => p) ?? null;
    if (person) {
      if (person.relation === 'self' || seenPeople.has(person.user_id)) continue;
      seenPeople.add(person.user_id);
    } else {
      if (keys.some((k) => seenKeys.has(k))) continue;
    }
    keys.forEach((k) => seenKeys.add(k));
    out.push({ name: c.name, phone: c.phones[0] ?? null, email: c.emails[0] ?? null, person });
  }
  return out;
}
