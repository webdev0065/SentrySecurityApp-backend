const express = require('express');
const router = express.Router();
const User = require('../../data/models/User');

router.post('/signup', async (req, res) => {
  const { full_name, mobile_number, email, password, confirm_password, account_type } = req.body;

  if (!full_name || !mobile_number || !email || !password || !confirm_password || !account_type) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (password !== confirm_password) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  if (!['agency', 'client'].includes(account_type)) {
    return res.status(400).json({ error: 'Invalid account type' });
  }

  try {
    const existingUser = await User.findByEmailOrMobile(email, mobile_number);

    if (existingUser) {
      return res.status(409).json({ error: 'Email or mobile number already registered' });
    }

    const newUser = await User.create({ full_name, mobile_number, email, password, account_type });

    res.status(201).json({ message: 'Account created successfully', user: newUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;