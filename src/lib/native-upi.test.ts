import { describe, expect, it } from 'vitest';
import { isAndroidApp, parseUpiResponse } from './native-upi';

describe('parseUpiResponse (what the UPI app reports back)', () => {
  it('reads a Google Pay success with its references', () => {
    expect(parseUpiResponse('txnId=ICI0a1b2c3&responseCode=00&Status=SUCCESS&txnRef=OWN123&ApprovalRefNo=428812345678')).toEqual({
      status: 'success',
      reference: '428812345678',
      raw: 'txnId=ICI0a1b2c3&responseCode=00&Status=SUCCESS&txnRef=OWN123&ApprovalRefNo=428812345678',
    });
  });

  it('accepts other apps\' spellings and lower-case keys', () => {
    expect(parseUpiResponse('status=success&txnRef=PH99')).toMatchObject({ status: 'success', reference: 'PH99' });
    expect(parseUpiResponse('Status=FAILURE&responseCode=ZD&txnId=X1')).toMatchObject({ status: 'failure', reference: 'X1' });
    expect(parseUpiResponse('Status=FAILED')).toMatchObject({ status: 'failure' });
    expect(parseUpiResponse('Status=SUBMITTED&txnId=P1')).toMatchObject({ status: 'pending' });
  });

  it('treats no answer (backed out, app closed) as unknown, so the user is asked', () => {
    expect(parseUpiResponse(null)).toEqual({ status: 'unknown', reference: null, raw: null });
    expect(parseUpiResponse('')).toMatchObject({ status: 'unknown' });
    expect(parseUpiResponse('responseCode=00')).toMatchObject({ status: 'unknown' });
  });

  it('decodes encoded values', () => {
    expect(parseUpiResponse('Status=SUCCESS&txnRef=OWN%20123')).toMatchObject({ reference: 'OWN 123' });
  });
});

describe('isAndroidApp', () => {
  it('is false in a browser', () => {
    expect(isAndroidApp()).toBe(false);
  });
});
