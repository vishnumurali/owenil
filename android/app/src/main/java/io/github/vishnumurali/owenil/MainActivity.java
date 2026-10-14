package io.github.vishnumurali.owenil;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-specific native code: paying with Google Pay / UPI apps, and
        // finding friends from the phone's contacts.
        registerPlugin(UpiPlugin.class);
        registerPlugin(ContactsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
