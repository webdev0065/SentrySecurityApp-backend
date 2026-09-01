const express = require('express');
const cors = require('cors');
require('dotenv').config();
const authRoutes = require('./apis/routes/authRoutes');
const userRoutes = require('./apis/routes/userRoutes');
const forgotPasswordRoutes = require('./apis/routes/forgotPasswordRoutes');
const agencyRoutes = require('./apis/routes/agencyRoutes');
const clientRoutes = require('./apis/routes/clientRoutes');
const otpRoutes = require('./apis/routes/otpRoutes');

const app = express();

app.use(cors()); 
app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;

app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api', forgotPasswordRoutes);
app.use('/api', agencyRoutes);
app.use('/api', clientRoutes);
app.use('/api', otpRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
