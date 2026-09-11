const Notification = require('../../data/models/Notification');

async function notifyAgency(agencyId, incident, message) {
  await Notification.createForRecipient({
    recipientId: agencyId,
    recipientType: 'agency',
    type: 'incident',
    targetRole: 'agency',
    title: 'Incident Report',
    message,
    referenceType: 'incident',
    referenceId: incident.id
  });
}

async function notifyClient(clientId, incident, message) {
  await Notification.createForRecipient({
    recipientId: clientId,
    recipientType: 'client',
    type: 'incident',
    targetRole: 'client',
    title: 'Incident Escalated',
    message,
    referenceType: 'incident',
    
    referenceId: incident.id
  });
}

module.exports = { notifyAgency, notifyClient };