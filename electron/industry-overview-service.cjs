async function loadIndustryOverviews(coordinator, refresh) {
  try {
    return await coordinator.run("domi:industry-overviews", refresh, {
      force: true, ttlMs: 0, retries: 0, allowStale: false,
      // A preserved human edit is a usable result, not an unavailable service.
      isSuccess: value => value?.ok === true || (Array.isArray(value?.entries) && value.entries.length > 0)
    });
  } catch (error) {
    return { ok: false, entries: [], error: error instanceof Error ? error.message : String(error) };
  }
}

module.exports = { loadIndustryOverviews };
