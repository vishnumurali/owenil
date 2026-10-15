import Capacitor
import Contacts
import UIKit

/// The app's web view, with Owenil's own native plugins registered.
class OwenilViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ContactsPlugin())
    }
}

/// Reads the phone's contacts (name, phone numbers, emails), including iCloud
/// and Google contacts synced to the phone, so Owenil can show which of them
/// already use Owenil. Runs only when the user asks, after they allow contacts
/// access. The app turns numbers and emails into one-way codes before anything
/// leaves the phone, and nothing is stored. Same interface as the Android
/// plugin (android/app/src/main/java/.../ContactsPlugin.java).
@objc(ContactsPlugin)
public class ContactsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ContactsPlugin"
    public let jsName = "Contacts"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getContacts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise),
    ]

    /// Enough for any real address book; keeps the reply small.
    private let maxContacts = 5000

    @objc func getContacts(_ call: CAPPluginCall) {
        let store = CNContactStore()
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .notDetermined:
            store.requestAccess(for: .contacts) { granted, _ in
                if granted {
                    self.read(store, call)
                } else {
                    call.reject("Contacts access was not allowed.", "PERMISSION_DENIED")
                }
            }
        case .denied, .restricted:
            call.reject("Contacts access was not allowed.", "PERMISSION_DENIED")
        default:
            // .authorized, and .limited (iOS 18: only the contacts the user picked).
            read(store, call)
        }
    }

    /// Opens Owenil's page in iOS Settings, where a refused permission can be allowed.
    @objc func openAppSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
            call.resolve()
        }
    }

    private func read(_ store: CNContactStore, _ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            let keys: [CNKeyDescriptor] = [
                CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
                CNContactPhoneNumbersKey as CNKeyDescriptor,
                CNContactEmailAddressesKey as CNKeyDescriptor,
            ]
            let request = CNContactFetchRequest(keysToFetch: keys)
            var contacts: [[String: Any]] = []
            do {
                try store.enumerateContacts(with: request) { contact, stop in
                    let phones = contact.phoneNumbers.map { $0.value.stringValue }
                    let emails = contact.emailAddresses.map { $0.value as String }
                    if phones.isEmpty && emails.isEmpty { return }
                    contacts.append([
                        "name": CNContactFormatter.string(from: contact, style: .fullName) ?? "",
                        "phones": phones,
                        "emails": emails,
                    ])
                    if contacts.count >= self.maxContacts { stop.pointee = true }
                }
                call.resolve(["contacts": contacts])
            } catch {
                call.reject("Contacts access was not allowed.", "PERMISSION_DENIED")
            }
        }
    }
}
