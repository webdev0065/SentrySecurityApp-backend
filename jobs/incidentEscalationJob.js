const cron = require('node-cron');
const Incident = require('../data/models/Incident');
const pool = require('../db');
const { notifyClient } = require('../apis/utils/notifyHelper');
const Notification = require('../data/models/Notification');
const {
  cancelIncidentSoundReminders,
} = require('./notificationSoundScheduler');

/**
 * Moves every incident whose 15-minute agency buzzer window has elapsed into the
 * client's alerts. Exported so it can be driven directly (cron or tests).
 */
async function runIncidentEscalation() {
  try {
    // Every incident reported by a guard surfaces here once its 15-minute
    // buzzer window has elapsed. Incidents are never deleted or hidden — they
    // stay on the agency list and additionally reach the client's alerts.
    const due = await Incident.findPendingForEscalation();
    for (const incident of due) {
      const escalated = await Incident.escalateToClient(incident.id);
      if (!escalated) continue;

      // The 15-minute buzzer window is over, so the agency loop stops and any
      // queued burst is dropped — client alerts are always silent.
      cancelIncidentSoundReminders(incident.id);
      await Notification.markSoundPendingByReference(
        'incident',
        incident.id,
        false,
        'agency',
      ).catch(() => null);

      // Same client lookup used by GET /client/alerts: site -> coverage request -> client.
      const clientResult = await pool.query(
        `SELECT cr.client_id
         FROM sites s
         JOIN coverage_requests cr ON cr.id = s.source_coverage_request_id
         WHERE s.id = $1`,
        [incident.site_id],
      );
      const clientId = clientResult.rows[0]?.client_id;
      if (clientId) {
        await notifyClient(
          clientId,
          escalated,
          `New incident at ${incident.site_name || 'your site'} needs your attention.`,
        );
      }
      console.log(`[escalation] incident ${incident.id} moved to client alerts`);
    }
  } catch (err) {
    console.error('[escalation] failed', err);
  }
}

cron.schedule('*/1 * * * *', runIncidentEscalation);

module.exports = { runIncidentEscalation };


console.log('Incident escalation cron job started');
