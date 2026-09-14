export const shorthands = undefined;

export const up = pgm => {
  pgm.sql(`
    INSERT INTO sites (
      agency_id, site_name, site_address, city, state,
      coverage_plan, source_coverage_request_id
    )
    SELECT
      agencies.user_id,
      COALESCE(NULLIF(coverage_requests.event_name, ''), coverage_requests.site_location),
      coverage_requests.site_location,
      coverage_requests.city,
      coverage_requests.state,
      'day_shift',
      coverage_requests.id
    FROM coverage_requests
    JOIN agencies ON agencies.id = COALESCE(
      coverage_requests.assigned_agency_id,
      coverage_requests.selected_agency_id
    )
    WHERE coverage_requests.status IN ('approved', 'assigned', 'completed')
      AND NOT EXISTS (
        SELECT 1 FROM sites
        WHERE sites.source_coverage_request_id = coverage_requests.id
      )
    ON CONFLICT (source_coverage_request_id) DO NOTHING;
  `);
};

export const down = pgm => {
  pgm.sql(`DELETE FROM sites WHERE source_coverage_request_id IS NOT NULL;`);
};
