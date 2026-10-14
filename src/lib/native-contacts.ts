import { registerPlugin } from '@capacitor/core';

/** One entry of the phone's address book, as saved there. */
export interface PhoneContact {
  name: string;
  phones: string[];
  emails: string[];
}

interface ContactsPlugin {
  getContacts(): Promise<{ contacts: PhoneContact[] }>;
  openAppSettings(): Promise<void>;
}

/** Native code in android/app/src/main/java/.../ContactsPlugin.java (Android app only). */
const Contacts = registerPlugin<ContactsPlugin>('Contacts');

export class ContactsAccessDenied extends Error {
  constructor() {
    super('Contacts access was not allowed.');
    this.name = 'ContactsAccessDenied';
  }
}

/** Reads the phone's contacts, asking for permission first when needed. */
export async function readPhoneContacts(): Promise<PhoneContact[]> {
  try {
    return (await Contacts.getContacts()).contacts ?? [];
  } catch (e) {
    if ((e as { code?: string } | null)?.code === 'PERMISSION_DENIED') throw new ContactsAccessDenied();
    throw e;
  }
}

/** Opens Owenil's page in Android settings (to allow a refused permission). */
export function openAppSettings(): Promise<void> {
  return Contacts.openAppSettings();
}
