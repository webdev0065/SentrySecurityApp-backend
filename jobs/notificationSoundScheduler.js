const Incident = require('../data/models/Incident');
const Notification = require('../data/models/Notification');

const activeTimers = new Map(); // key: incidentId

const INTERVAL_MS = 5 * 60 * 1000;        // 5 minutes
const TOTAL_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const MAX_TICKS = TOTAL_DURATION_MS / INTERVAL_MS; // 3 repeats after the initial trigger

function scheduleIncidentSoundReminders(incidentId) {
  cancelIncidentSoundReminders(incidentId); // clear any stale timer for this id

  let ticks = 0;
  triggerCheck(); // fire immediately when incident is created

  const timer = setInterval(triggerCheck, INTERVAL_MS);
  activeTimers.set(incidentId, timer);

  async function triggerCheck() {
    ticks++;

    const incident = await Incident.findById(incidentId);

    // ⚠️ ASSUMPTION: adjust to match Incident.js's real acknowledged-check.
    // Incident.acknowledge() already returns null for "already handled" incidents,
    // so mirror whatever condition that method uses internally.
    const isAcknowledged = !incident || incident.status === 'acknowledged' || incident.acknowledged_at;

    if (isAcknowledged) {
      cancelIncidentSoundReminders(incidentId);
      return;
    }

    await Notification.markSoundPendingByReference('incident', incidentId, true);
    console.log(`[sound-reminder] tick ${ticks} for incident ${incidentId}`);

    if (ticks >= MAX_TICKS) {
      cancelIncidentSoundReminders(incidentId);
    }
  }
}

function cancelIncidentSoundReminders(incidentId) {
  const timer = activeTimers.get(incidentId);
  if (timer) {
    clearInterval(timer);
    activeTimers.delete(incidentId);
  }
}

module.exports = { scheduleIncidentSoundReminders, cancelIncidentSoundReminders };