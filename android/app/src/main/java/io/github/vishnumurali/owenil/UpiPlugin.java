package io.github.vishnumurali.owenil;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Starts a UPI payment in the user's UPI app (Google Pay, or any UPI app) and
 * returns that app's response, for example
 * "txnId=…&responseCode=00&Status=SUCCESS&txnRef=…".
 *
 * Owenil never moves money: the UPI app does, after the user approves it there.
 */
@CapacitorPlugin(name = "Upi")
public class UpiPlugin extends Plugin {

    /** Whether a UPI app (optionally a specific one, e.g. Google Pay) is installed. */
    @PluginMethod
    public void canPay(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("upi://pay"));
        String pkg = call.getString("package");
        if (pkg != null) intent.setPackage(pkg);
        PackageManager pm = getContext().getPackageManager();
        JSObject ret = new JSObject();
        ret.put("available", !pm.queryIntentActivities(intent, 0).isEmpty());
        call.resolve(ret);
    }

    /** Opens the payment in the given UPI app (or lets the user choose one). */
    @PluginMethod
    public void pay(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || !uri.startsWith("upi://pay?")) {
            call.reject("That isn't a UPI payment link.", "INVALID_URI");
            return;
        }
        PackageManager pm = getContext().getPackageManager();
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
        String pkg = call.getString("package");
        Intent launch = intent;
        if (pkg != null) {
            intent.setPackage(pkg);
            if (pm.queryIntentActivities(intent, 0).isEmpty()) {
                call.reject("That UPI app isn't installed on this phone.", "APP_NOT_FOUND");
                return;
            }
        } else {
            if (pm.queryIntentActivities(intent, 0).isEmpty()) {
                call.reject("No UPI app is installed on this phone.", "APP_NOT_FOUND");
                return;
            }
            launch = Intent.createChooser(intent, "Pay with");
        }
        try {
            startActivityForResult(call, launch, "paymentResult");
        } catch (ActivityNotFoundException e) {
            call.reject("No UPI app could open this payment.", "APP_NOT_FOUND");
        }
    }

    @ActivityCallback
    private void paymentResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        String response = null;
        if (data != null) {
            response = data.getStringExtra("response");
            if (response == null && data.getStringExtra("Status") != null) {
                response = "Status=" + data.getStringExtra("Status");
            }
        }
        JSObject ret = new JSObject();
        ret.put("resultCode", result.getResultCode());
        ret.put("response", response);
        call.resolve(ret);
    }
}
