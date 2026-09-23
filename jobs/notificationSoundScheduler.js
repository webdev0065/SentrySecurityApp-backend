const cron = require('node-cron');
const Incident = require('../data/models/Incident');
const Notification = require('../data/models/Notification');

const activeTimers = new Map(); // key: incidentId

const INTERVAL_MS = 5 * 60 * 1000;        // 5 minutes
const TOTAL_DURATION_MS = 15 * 60 * 1000; // 15 minutes
// Buzz immediately, then every 5 minutes for the whole 15-minute window:
// 0, 5, 10 and 15 minutes = 4 bursts. After the last one the incident is handed
// over to client alerts (see jobs/incidentEscalationJob.js).
const MAX_BURSTS = TOTAL_DURATION_MS / INTERVAL_MS + 1;

/**
 * Arms the agency notification so the app plays the bundled buzzer, and records
 * the burst against the incident. Only 'agency' notifications are ever armed —
 * the client escalation alert for the same incident is always silent.
 */
async function sendBurst(incidentId) {
  await Notification.markSoundPendingByReference(
    'incident',
    incidentId,
    true,
    'agency',
  );
  const updated = await Incident.markReminderSent(incidentId).catch(() => null);
  console.log(
    `[sound-reminder] burst ${updated?.reminder_count ?? '?'}/${MAX_BURSTS} for incident ${incidentId}`,
  );
  return updated;
}

/**
 * Starts the agency buzzer loop for a freshly reported incident.
 * Every tick re-reads the incident, so acknowledging it (the agency has seen it)
 * stops the loop immediately.
 */
function scheduleIncidentSoundReminders(incidentId) {
  cancelIncidentSoundReminders(incidentId); // clear any stale timer for this id

  let bursts = 0;

  const timer = setInterval(triggerCheck, INTERVAL_MS);
  activeTimers.set(incidentId, timer);
  triggerCheck(); // fire immediately when incident is created

  async function triggerCheck() {
    try {
      if (!activeTimers.has(incidentId)) return;

      // Re-read the live incident row; acknowledged_at set by agency stops the loop.
      const incident = await Incident.findById(incidentId, null);

      const isHandled =
        !incident ||
        incident.acknowledged_at ||
        incident.escalated_at ||
        (incident.status &&
          incident.status !== 'pending' &&
          incident.status !== 'open');

      if (isHandled) {
        cancelIncidentSoundReminders(incidentId);
        return;
      }

      await sendBurst(incidentId);

      bursts += 1;
      if (bursts >= MAX_BURSTS) {
        cancelIncidentSoundReminders(incidentId);
      }
    } catch (err) {
      // A failed tick must never kill the loop via an unhandled rejection.
      console.error(`[sound-reminder] tick failed for incident ${incidentId}`, err);
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

/**
 * Restart-safe fallback: re-arms every incident whose 5-minute burst is due
 * according to reminder_count. Without this a backend restart mid-window would
 * silently drop the remaining buzzes.
 */
async function sweepIncidentSoundReminders() {
  try {
    const due = await Incident.findDueForSoundReminder();
    for (const incident of due) {
      // If this process already owns a live 5-minute timer for the incident,
      // let it deliver the burst. Two owners firing the same burst would
      // advance reminder_count twice and steal one of the four buzzes.
      if (activeTimers.has(incident.id)) continue;
      await sendBurst(incident.id);
    }
  } catch (err) {
    console.error('[sound-reminder] sweep failed', err);
  }
}

cron.schedule('* * * * *', sweepIncidentSoundReminders);

module.exports = {
  scheduleIncidentSoundReminders,
  cancelIncidentSoundReminders,
  sweepIncidentSoundReminders,
};
