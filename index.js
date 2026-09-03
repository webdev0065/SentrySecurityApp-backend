const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const authRoutes = require('./apis/routes/authRoutes');
const userRoutes = require('./apis/routes/userRoutes');
const forgotPasswordRoutes = require('./apis/routes/forgotPasswordRoutes');
const agencyRoutes = require('./apis/routes/agencyRoutes');
const clientRoutes = require('./apis/routes/clientRoutes');
const otpRoutes = require('./apis/routes/otpRoutes');
const siteRoutes = require('./apis/routes/siteRoutes');
const incidentRoutes = require('./apis/routes/incidentRoutes');
const guardRoutes = require('./apis/routes/guardRoutes');
const coverageRoutes = require('./apis/routes/coverageRoutes');

const app = express();

app.use(cors()); 
app.use(express.json());

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
app.use('/api/agency', siteRoutes);
app.use('/api/agency', incidentRoutes);
app.use('/api/agency', guardRoutes);
app.use('/apis', coverageRoutes);

app.use('/api', require('./apis/routes/profilePhoto'));   
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
