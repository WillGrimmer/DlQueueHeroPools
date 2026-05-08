const admin = require('firebase-admin');

// Storing the full service account JSON as one env var lets JSON.parse handle
// the private key newlines correctly — avoids OpenSSL decoding errors from
// Railway/other hosts mangling \n escape sequences in individual env vars.
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin.firestore();
