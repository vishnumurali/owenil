package io.github.vishnumurali.owenil;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-specific native code: paying with Google Pay / UPI apps.
        registerPlugin(UpiPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
