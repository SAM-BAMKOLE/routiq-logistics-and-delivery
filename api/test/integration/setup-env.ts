/**
 * Runs in each Jest worker before the integration specs (and their imports)
 * load.
 *
 * Every integration suite shares one database, and the outbox is a global
 * table the suites assert on directly. A background relay poll firing mid
 * assertion would make that non-deterministic, so the timer stays off here and
 * the specs that need it drive `relayOnce()` by hand.
 */
process.env.OUTBOX_RELAY_ENABLED = 'false';
