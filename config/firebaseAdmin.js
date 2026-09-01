const { initializeApp, cert } = require('firebase-admin/app');
const serviceAccount = require('./firebase-service-account.json');

const app = initializeApp({
  credential: cert(serviceAccount)
});

module.exports = app;
