'use strict';

const config = require('wild-config');
const log = require('npmlog');
const smtp = require('./smtp');
const db = require('./lib/db');

// Initialize database connection
db.connect(err => {
    if (err) {
        log.error('Db', 'Failed to setup database connection');
        return process.exit(1);
    }
    // Start SMTP server
    smtp(err => {
        if (err) {
            log.error('App', 'Failed to start SMTP server. %s', err.message);
            return process.exit(1);
        }

        log.info('App', 'All servers started, ready to process some mail');

        // downgrade user and group if needed
        if (config.group) {
            try {
                process.setgid(config.group);
                log.info('App', 'Changed group to "%s" (%s)', config.group, process.getgid());
            } catch (E) {
                log.error('App', 'Failed to change group to "%s" (%s)', config.group, E.message);
                return process.exit(1);
            }
        }
        if (config.user) {
            try {
                process.setuid(config.user);
                log.info('App', 'Changed user to "%s" (%s)', config.user, process.getuid());
            } catch (E) {
                log.error('App', 'Failed to change user to "%s" (%s)', config.user, E.message);
                return process.exit(1);
            }
        }
    });
});
