package io.github.vishnumurali.owenil.fakeupi;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/**
 * Answers a upi://pay request at once, the way a UPI app reports a finished
 * payment. The reference echoes the requested amount, so the test can tell the
 * payment link arrived intact.
 */
public class PayActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri request = getIntent().getData();
        String amount = request == null ? null : request.getQueryParameter("am");
        Intent result = new Intent();
        result.putExtra("response", "txnId=FAKE1&responseCode=00&Status=SUCCESS&txnRef=FAKE-" + amount);
        setResult(RESULT_OK, result);
        finish();
    }
}
