const Incident = require('../data/models/Incident');           
const { notifyAgency, notifyClient } = require('../apis/utils/notifyHelper');
console.log('⏰ Incident escalation cron job started');