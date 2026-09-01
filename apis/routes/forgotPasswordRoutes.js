const express = require('express');
const router = express.Router();
const User = require('../../data/models/User');

router.post('/forgot-password', async (req, res) => {
    const { identifier } = req.body;

    if (!identifier) {
        return res.status(400).json({ error: 'Email or Mobile number is required' });
    }

    try {
        const user = await User.findByEmailOrMobileForLogin(identifier);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = new Date(Date.now() + 10 * 60 * 1000); 

        // Yahan 'identifier' ki jagah 'user.email' use karo — guaranteed match, kyunki
        // user already DB se mil chuka hai upar wale query se
        await User.setOtp(user.email, otp, expiry);

        const response = { message: 'OTP sent successfully' };
        if (process.env.NODE_ENV !== 'production') response.otp = otp;
        res.json(response);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// router.post('/verify-otp', async (req, res) => {
router.post('/verify-forgot-password-otp', async (req, res) => {
    const { identifier, otp } = req.body;
    if (!identifier || !otp) {
        return res.status(400).json({ error: 'Identifier and OTP are required' });
    }
    try {
        const foundUser = await User.findByEmailOrMobileForLogin(identifier);
        if (!foundUser) {
            return res.status(404).json({ error: 'User not found' });
        }
        const user = await User.verifyOtp(foundUser.email, otp);
        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired OTP' });
        }
        res.json({ message: 'OTP verified successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/reset-password', async (req, res) => {
    const { identifier, new_password, confirm_password } = req.body;

    if (!identifier || !new_password || !confirm_password) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    if (new_password !== confirm_password) {
        return res.status(400).json({ error: 'Passwords do not match' });
    }

    try {
        const foundUser = await User.findByEmailOrMobileForLogin(identifier);

        if (!foundUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        await User.resetPassword(foundUser.email, new_password);

        res.json({ message: 'Password reset successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
