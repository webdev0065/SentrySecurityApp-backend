const express = require('express');
const router = express.Router();
const client = require('../../config/twilio');

router.post('/send-otp', async (req, res) => {
  const { phoneNumber } = req.body;
  try {
    const verification = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: phoneNumber, channel: 'sms' });
    res.json({ success: true, status: verification.status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

    router.post('/verify-mobile-otp', async (req, res) => {
  const { phoneNumber, code } = req.body;
  try {
    const check = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phoneNumber, code });
    res.json({ success: check.status === 'approved' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
