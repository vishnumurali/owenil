package io.github.vishnumurali.owenil;

import android.Manifest;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * Reads the phone's contacts (name, phone numbers, emails), including Google
 * contacts synced to the phone, so Owenil can show which of them already use
 * Owenil. Runs only when the user asks, after they allow contacts access. The
 * app turns numbers and emails into one-way codes before anything leaves the
 * phone, and nothing is stored.
 */
@CapacitorPlugin(
    name = "Contacts",
    permissions = { @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }) }
)
public class ContactsPlugin extends Plugin {

    /** Enough for any real address book; keeps the reply small. */
    private static final int MAX_CONTACTS = 5000;

    @PluginMethod
    public void getContacts(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "contactsPermission");
            return;
        }
        readContacts(call);
    }

    @PermissionCallback
    private void contactsPermission(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            getBridge().execute(() -> readContacts(call));
        } else {
            call.reject("Contacts access was not allowed.", "PERMISSION_DENIED");
        }
    }

    /** Opens Owenil's page in Android settings, where a refused permission can be allowed. */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    private void readContacts(PluginCall call) {
        Map<Long, String> names = new LinkedHashMap<>();
        Map<Long, Set<String>> phones = new LinkedHashMap<>();
        Map<Long, Set<String>> emails = new LinkedHashMap<>();
        String phoneType = ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE;
        String emailType = ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE;
        String[] projection = {
            ContactsContract.Data.CONTACT_ID,
            ContactsContract.Data.DISPLAY_NAME_PRIMARY,
            ContactsContract.Data.MIMETYPE,
            ContactsContract.Data.DATA1,
        };
        try (
            Cursor c = getContext().getContentResolver().query(
                ContactsContract.Data.CONTENT_URI,
                projection,
                ContactsContract.Data.MIMETYPE + " IN (?, ?)",
                new String[] { phoneType, emailType },
                ContactsContract.Data.DISPLAY_NAME_PRIMARY + " COLLATE LOCALIZED ASC"
            )
        ) {
            while (c != null && c.moveToNext()) {
                long id = c.getLong(0);
                String value = c.getString(3);
                if (value == null || value.trim().isEmpty()) continue;
                if (!names.containsKey(id)) {
                    if (names.size() >= MAX_CONTACTS) continue;
                    String name = c.getString(1);
                    names.put(id, name == null ? "" : name);
                    phones.put(id, new LinkedHashSet<>());
                    emails.put(id, new LinkedHashSet<>());
                }
                if (phoneType.equals(c.getString(2))) phones.get(id).add(value.trim());
                else emails.get(id).add(value.trim());
            }
        } catch (SecurityException e) {
            call.reject("Contacts access was not allowed.", "PERMISSION_DENIED");
            return;
        }
        JSArray list = new JSArray();
        for (Map.Entry<Long, String> entry : names.entrySet()) {
            JSObject contact = new JSObject();
            contact.put("name", entry.getValue());
            contact.put("phones", new JSArray(phones.get(entry.getKey())));
            contact.put("emails", new JSArray(emails.get(entry.getKey())));
            list.put(contact);
        }
        JSObject ret = new JSObject();
        ret.put("contacts", list);
        call.resolve(ret);
    }
}
