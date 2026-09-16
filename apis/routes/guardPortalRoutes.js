const express = require('express');
const Guard = require('../../data/models/Guard');
const verifyToken = require('../middleware/authMiddleware');

const router = express.Router();

router.use(verifyToken);

router.use((req, res, next) => {
  if (req.user.account_type !== 'guard') {
    return res.status(403).json({ error: 'Guard access is required.' });
  }
  next();
});

router.get('/me', async (req, res) => {
  try {
    const guard = await Guard.findByUserId(req.user.id);
    if (!guard) return res.status(404).json({ error: 'Guard profile was not found.' });
    return res.json({ success: true, data: guard });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.put('/duty', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['on_duty', 'off_duty'].includes(status)) {
      return res.status(400).json({ error: 'Duty status must be on_duty or off_duty.' });
    }
    const updated = await Guard.updateDutyStatusByUserId(req.user.id, status);
    if (!updated) return res.status(404).json({ error: 'Guard profile was not found.' });
    const guard = await Guard.findByUserId(req.user.id);
    return res.json({ success: true, data: guard });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
